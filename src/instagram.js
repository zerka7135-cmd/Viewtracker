import fs from 'fs';
import { config } from './config.js';
import { scrapeInstagram, scrapeYoutube } from './scraperClient.js';

// Instagram et YouTube sont scrapés via scraper-service (Python/Scrapling,
// voir scraper-service/ et src/scraperClient.js) — remplace l'ancien
// scraping Playwright inline, dont le principal point de fragilité était
// des sélecteurs DOM qui cassaient silencieusement à chaque changement de
// page (voir git history de ce fichier). Scrapling relocalise ces
// sélecteurs automatiquement ("adaptive scraping") côté service Python.
//
// TikTok reste inchangé ci-dessous : déjà migré vers l'API tierce
// tiktokapi.store (voir commentaire dans la branche TikTok), aucun
// navigateur impliqué.

// Mode test : FAST_MODE=1 réduit drastiquement les délais volontaires pour
// vérifier rapidement que le scraping fonctionne. À ne jamais utiliser en
// production (le pattern de requêtes redevient facilement détectable).
const FAST_MODE = process.env.FAST_MODE === '1';

/**
 * Attend une durée aléatoire (en ms) entre minMs et maxMs.
 * Évite d'enchaîner les requêtes à un rythme parfaitement régulier,
 * qui est un signal typique de détection de bot — pertinent même si le
 * fetch de page se fait maintenant côté scraper-service : c'est
 * l'espacement des requêtes dans le temps, pas seulement leur contenu, qui
 * distingue un humain d'un script.
 */
function randomDelay(minMs, maxMs) {
  if (FAST_MODE) return new Promise(resolve => setTimeout(resolve, 50));
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/** Mélange un tableau (Fisher-Yates) sans modifier l'original. */
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Exécute `scrapeFn` (qui doit renvoyer `{ total, posts }`, `posts` étant le
 * détail par vidéo — id + vues, déjà extrait côté scraper-service pour
 * IG/YT) avec une nouvelle tentative en cas d'échec (exception ou total à
 * 0) : un échec ponctuel (rendu lent, service temporairement indisponible,
 * léger ralentissement réseau) ne fait alors pas remonter une fausse alerte
 * "sélecteurs obsolètes".
 * @returns {{ total: number, posts: Array<{id: string, views: number}>, error: string|null }}
 */
async function scrapeWithRetry(platform, scrapeFn, attempts = 2) {
  let lastMessage = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await scrapeFn();
      if (result.total > 0) return { total: result.total, posts: result.posts || [], error: null };
      lastMessage = 'Aucune vue détectée (page inattendue ou sélecteurs obsolètes)';
    } catch (e) {
      console.error(`Erreur ${platform} (tentative ${attempt}/${attempts}) :`, e.message);
      lastMessage = e.message;
    }

    // Backoff exponentiel : un échec dû à un rate-limit temporaire a plus
    // de chances de passer en laissant plus de temps avant chaque nouvelle
    // tentative, plutôt qu'un délai fixe qui retente trop tôt.
    if (attempt < attempts) {
      const factor = 2 ** (attempt - 1);
      await randomDelay(2000 * factor, 5000 * factor);
    }
  }

  return { total: 0, posts: [], error: lastMessage };
}

/**
 * Charge les cookies de session Instagram, une seule fois par collecte
 * (identiques pour tous les comptes) — sur Railway (pas de volume monté),
 * fournis directement via IG_COOKIES_JSON ; en local, lus depuis le fichier
 * exporté par scripts/export-ig-cookies.js ou src/login.js.
 * @returns {Array} tableau de cookies au format attendu par scraper-service, [] si absent.
 */
function loadIgCookies() {
  try {
    if (process.env.IG_COOKIES_JSON) {
      return JSON.parse(process.env.IG_COOKIES_JSON);
    }
    const cookiesPath = process.env.IG_COOKIES_PATH || './src/ig-cookies.json';
    if (fs.existsSync(cookiesPath)) {
      return JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
    }
  } catch (e) {
    console.error('Erreur de lecture des cookies Instagram :', e.message);
  }
  return [];
}

export async function buildViewsSummary(accounts = config.accounts, postsLimit = config.postsLimit) {
  const summary = [];
  const igCookies = loadIgCookies();

  // Ordre des comptes randomisé à chaque exécution : évite de reproduire
  // exactement le même schéma de navigation jour après jour.
  const shuffledAccounts = shuffle(accounts);

  let isFirstAccount = true;

  for (const user of shuffledAccounts) {
    // null = pas de compte sur cette plateforme (url vide dans ACCOUNTS,
    // ex. "Ban"), distinct de 0 vue qui signifierait un vrai échec de
    // scraping. Affiché "Ban" dans l'embed plutôt qu'un 0 trompeur, et
    // sans lever d'alerte inutile puisqu'il n'y a rien à scraper.
    let igTotal = null;
    let ttTotal = null;
    let ytTotal = null;
    // Détail par vidéo ({id, views}[]) pour le suivi de croissance par ID
    // plutôt que par total brut de la fenêtre — voir history.js#computeGrowth24h.
    // null tant que la plateforme n'est pas configurée, comme les *Total ci-dessus.
    let igPosts = null;
    let ttPosts = null;
    let ytPosts = null;
    const errors = []; // Trace des échecs de scraping pour ce compte (visible dans le résumé)

    // Pause plus marquée entre deux comptes qu'entre deux requêtes d'un
    // même compte : un humain qui enchaîne 20 profils sans jamais s'arrêter
    // ne ressemble à rien de naturel.
    if (!isFirstAccount) await randomDelay(4000, 12000);
    isFirstAccount = false;

    // Ordre des plateformes mélangé à chaque compte : IG/TikTok/YouTube ne
    // sont pas toujours visités dans le même ordre d'un jour ou d'un
    // compte à l'autre.
    for (const url of shuffle(user.urls)) {
      if (!url) continue; // Emplacement vide ("Ban") : rien à scraper.

      // --- INSTAGRAM ---
      if (url.includes('instagram.com')) {
        const { total, posts, error } = await scrapeWithRetry('IG', async () => {
          // Délai plus large que TikTok/YouTube : Instagram est la seule
          // plateforme où on utilise une session connectée, donc le compte
          // le plus exposé à une détection basée sur le rythme des requêtes.
          await randomDelay(5000, 15000);
          return scrapeInstagram(url, postsLimit, igCookies);
        });

        igTotal = total;
        igPosts = posts;
        if (error) errors.push({ platform: 'Instagram', message: error });
      }

      // --- TIKTOK ---
      else if (url.includes('tiktok.com')) {
        const { total, posts, error } = await scrapeWithRetry('TikTok', async () => {
          // TikTok bloque désormais Playwright derrière un captcha slider
          // ("Drag the slider to fit the puzzle"), reproductible même avec
          // IP résidentielle, navigateur non-headless, cookies frais et
          // patch anti-détection CDP (rebrowser-playwright) — testé le
          // 08/08/2026, les 4 pistes ont échoué. On passe donc par l'API
          // tierce tiktokapi.store (scraping fait côté fournisseur), qui
          // évite complètement le navigateur pour cette plateforme.
          const username = new URL(url).pathname.replace(/^\/@?/, '').replace(/\/$/, '');

          const apiUrl = new URL('https://tiktokapi.store/api/v1/user/posts');
          apiUrl.searchParams.set('unique_id', `@${username}`);
          apiUrl.searchParams.set('count', String(Math.max(10, postsLimit * 2))); // marge au-delà de postsLimit pour compenser les vidéos épinglées exclues
          apiUrl.searchParams.set('cursor', '0');

          const res = await fetch(apiUrl, {
            headers: { Authorization: `Bearer ${process.env.TIKTOK_API_KEY}` }
          });
          if (!res.ok) {
            throw new Error(`tiktokapi.store a répondu ${res.status} pour @${username}`);
          }
          const body = await res.json();
          if (body.code !== 0) {
            throw new Error(`tiktokapi.store: ${body.msg || 'erreur inconnue'} (@${username})`);
          }

          // Les vidéos épinglées (is_top === 1) sont ignorées, comme pour
          // IG/YT, pour ne pas fausser la mesure d'activité récente.
          const videos = (body.data?.videos || []).filter(v => v.is_top !== 1);
          const counted = videos.slice(0, postsLimit).map(v => ({ id: v.video_id, val: v.play_count || 0 }));
          const sum = counted.reduce((acc, v) => acc + v.val, 0);

          const posts = counted.filter(c => c.id).map(c => ({ id: c.id, views: c.val }));
          return { total: sum, posts };
        });

        ttTotal = total;
        ttPosts = posts;
        if (error) errors.push({ platform: 'TikTok', message: error });
      }

      // --- YOUTUBE ---
      else if (url.includes('youtube.com')) {
        const { total, posts, error } = await scrapeWithRetry('YT', async () => {
          await randomDelay(3000, 8000);
          return scrapeYoutube(url, postsLimit);
        });

        ytTotal = total;
        ytPosts = posts;
        if (error) errors.push({ platform: 'YouTube', message: error });
      }
    }

    summary.push({
      account: user.name,
      ig: igTotal,
      tt: ttTotal,
      yt: ytTotal,
      total: (igTotal || 0) + (ttTotal || 0) + (ytTotal || 0),
      errors,
      posts: { ig: igPosts, tt: ttPosts, yt: ytPosts }
    });
  }

  return summary;
}
