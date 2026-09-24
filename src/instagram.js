import fs from 'fs';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { config } from './config.js';
import { fetchTikTokPosts } from './tiktok.js';
import { extractInstagramViews, extractYouTubeViews } from './parseViews.js';

chromium.use(stealth());

// --- Techniques anti-détection ---

// Mode test : FAST_MODE=1 réduit drastiquement les délais volontaires pour
// vérifier rapidement que le scraping fonctionne. À ne jamais utiliser en
// production (le pattern de requêtes redevient facilement détectable).
const FAST_MODE = process.env.FAST_MODE === '1';

// Debug : DEBUG_SCRAPE=1 affiche le détail des vues comptées par post/vidéo
// (utile pour diagnostiquer un chiffre suspect). Coupé par défaut pour ne pas
// polluer les logs à chaque scan (ex. cron sur Railway).
const DEBUG_SCRAPE = process.env.DEBUG_SCRAPE === '1';

/**
 * Attend une durée aléatoire (en ms) entre minMs et maxMs.
 * Évite d'enchaîner les requêtes à un rythme parfaitement régulier,
 * qui est un signal typique de détection de bot.
 */
function randomDelay(minMs, maxMs) {
  if (FAST_MODE) return new Promise(resolve => setTimeout(resolve, 50));
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

// Quelques user-agents desktop récents et plausibles. Un seul UA fixe
// utilisé sur toutes les requêtes est un signal de détection facile.
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
];

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Un referer de moteur de recherche est un signal d'arrivée organique,
// contrairement à une requête sans aucun referer (typique d'un script qui
// appelle directement une URL).
const REFERERS = [
  'https://www.google.com/',
  'https://www.google.fr/',
  'https://www.bing.com/',
  'https://duckduckgo.com/'
];

function randomReferer() {
  return REFERERS[Math.floor(Math.random() * REFERERS.length)];
}

// Le scraping ne lit que du texte/JSON dans le DOM : bloquer images, vidéos,
// polices et médias évite de gonfler inutilement la mémoire de Chromium
// (contrainte importante sur le plan Railway à 512 Mo).
async function blockHeavyResources(context) {
  await context.route('**/*', route => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font'].includes(type)) return route.abort();
    return route.continue();
  });
}

// Tailles de fenêtre plausibles pour des écrans desktop courants.
function randomViewport() {
  const width = 1280 + Math.floor(Math.random() * (1920 - 1280));
  const height = 800 + Math.floor(Math.random() * (1080 - 800));
  return { width, height };
}

// Toutes nos sessions tournent sur la même machine réelle : sans ça,
// navigator.hardwareConcurrency/deviceMemory seraient identiques sur tous
// les contextes, un signal de plus permettant de relier les sessions entre
// elles malgré des UA/viewports différents. On ajoute aussi un léger bruit
// sur le canvas : son empreinte (toDataURL) est autrement parfaitement stable
// d'une session à l'autre sur la même machine, un signal de fingerprinting
// classique pour recouper des sessions soi-disant différentes.
async function randomizeHardwareFingerprint(context) {
  const cores = [4, 8, 12, 16][Math.floor(Math.random() * 4)];
  const memory = [4, 8, 16][Math.floor(Math.random() * 3)];
  const canvasSeed = Math.floor(Math.random() * 1000000);
  await context.addInitScript(({ cores, memory, canvasSeed }) => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => memory });

    let seed = canvasSeed;
    function noise() {
      seed = (seed * 9301 + 49297) % 233280;
      return (seed / 233280 - 0.5) * 2;
    }

    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const ctx = this.getContext('2d');
      if (ctx) {
        const imageData = ctx.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + noise()));
        }
        ctx.putImageData(imageData, 0, 0);
      }
      return originalToDataURL.apply(this, args);
    };
  }, { cores, memory, canvasSeed });
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
 * "Warm-up" : visite une page intermédiaire avant la page cible, avec une
 * courte pause, pour imiter un vrai parcours de navigation plutôt qu'un
 * accès direct à une URL précise (pattern typique de scraper).
 */
async function warmUp(page, url) {
  if (FAST_MODE) return;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await randomDelay(1000, 2500);
}

/**
 * Simule un comportement humain basique (déplacements de souris + scroll
 * irrégulier) avant de lire les données affichées. Un script qui charge une
 * page puis lit immédiatement le DOM sans la moindre interaction est un
 * signal facile à détecter ; ces quelques gestes n'y ressemblent plus tout à
 * fait.
 */
async function simulateHumanBehavior(page) {
  if (FAST_MODE) return;
  try {
    const steps = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < steps; i++) {
      await page.mouse.move(
        Math.floor(Math.random() * 1000),
        Math.floor(Math.random() * 700),
        { steps: 5 + Math.floor(Math.random() * 10) }
      );
      await randomDelay(200, 600);
    }
    await page.mouse.wheel(0, 300 + Math.floor(Math.random() * 500));
    await randomDelay(400, 900);
  } catch {
    // Simple confort visuel, une erreur ici ne doit jamais faire échouer le scraping.
  }
}

/**
 * Exécute `scrapeFn` (qui doit renvoyer `{ total, posts }`, `posts` étant le
 * détail par vidéo — voir extractIdFromHref ci-dessous) avec une nouvelle
 * tentative en cas d'échec (exception ou total à 0) : un échec ponctuel
 * (rendu lent, bandeau de consentement raté, léger ralentissement réseau)
 * ne fait alors pas remonter une fausse alerte "sélecteurs obsolètes".
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

// Extrait l'identifiant unique d'une vidéo depuis son URL (ex. l'ID du reel
// dans "/username/reel/DQe-xxxx/"), pour pouvoir suivre ses vues dans le
// temps même quand elle change de position dans le top N suivi. `null` si
// l'URL n'a pas le format attendu — le post est alors ignoré du suivi par ID
// (voir history.js#computeGrowth24h, qui retombe sur l'ancien calcul par
// total brut quand aucun ID n'a pu être extrait).
function extractIdFromHref(href, pattern) {
  if (!href) return null;
  const match = href.match(pattern);
  return match ? match[1] : null;
}

export async function buildViewsSummary(accounts = config.accounts, postsLimit = config.postsLimit) {
  const summary = [];
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      // Empêche Chromium d'exposer certains indicateurs d'automatisation au
      // niveau moteur, avant même que le plugin stealth n'ait à les corriger
      // côté JS (ceinture et bretelles).
      '--disable-blink-features=AutomationControlled'
    ]
  });

  try {
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

            const igContext = await browser.newContext({
              userAgent: randomUserAgent(),
              viewport: randomViewport(),
              locale: 'fr-FR',
              timezoneId: 'Europe/Paris',
              extraHTTPHeaders: { referer: randomReferer() }
            });
            await blockHeavyResources(igContext);
            await randomizeHardwareFingerprint(igContext);

            try {
              // Sur Railway (pas de volume monté), les cookies sont fournis
              // directement via la variable d'env IG_COOKIES_JSON. En local,
              // on lit le fichier exporté par scripts/export-ig-cookies.js.
              if (process.env.IG_COOKIES_JSON) {
                const cookies = JSON.parse(process.env.IG_COOKIES_JSON);
                await igContext.addCookies(cookies);
              } else {
                const cookiesPath = process.env.IG_COOKIES_PATH || './src/ig-cookies.json';
                if (fs.existsSync(cookiesPath)) {
                  const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
                  await igContext.addCookies(cookies);
                }
              }

              const page = await igContext.newPage();
              const cleanUrl = url.replace(/\/$/, '');

              // Warm-up : on visite d'abord le profil, comme le ferait un humain,
              // avant d'aller directement sur l'onglet Reels.
              await warmUp(page, cleanUrl);
              await page.goto(`${cleanUrl}/reels/`, { waitUntil: 'networkidle', timeout: 30000 });

              // Le flow "pay or consent" de Meta (conformité UE) peut rediriger
              // n'importe quelle navigation vers un écran de consentement
              // bloquant tant que la session ne l'a pas validé une fois — vécu
              // le 10/08, où ça a fait échouer TOUS les comptes IG d'un coup
              // avec le message générique "aucune vue détectée", sans piste
              // claire. On détecte ce cas précis pour un message actionnable
              // immédiatement plutôt qu'un diagnostic à refaire à chaque fois.
              if (page.url().includes('/consent/')) {
                throw new Error('Redirigé vers l\'écran de consentement Meta ("pay or consent") — cookies IG à renouveler via npm run export-ig-cookies en validant l\'écran manuellement');
              }

              await simulateHumanBehavior(page);

              // Le navigateur ne fait que relever les textes bruts ; la
              // conversion en nombres se fait côté Node (voir parseViews.js),
              // où elle est testée — elle gère notamment les formats
              // français ("1,2 M", "12,3 k", "1 234").
              const raw = await page.evaluate(() => {
                // 1. Grille des reels : chaque vignette est un <a href=".../reel/..."> dont
                // le innerText est directement le nombre de vues (ex. "277K").
                // Les reels épinglés (badge "Pinned post icon") sont ignorés : ils ne
                // reflètent pas l'activité récente et fausseraient la moyenne des derniers posts.
                //
                // Attention : le conteneur "div._ac7v" regroupe toute une LIGNE de la
                // grille (3 reels), pas une vignette individuelle — s'y fier directement
                // marque à tort les 2 voisins d'un reel épinglé comme épinglés eux aussi
                // (bug identifié le 5 août). À la place, on associe chaque badge "Pinned"
                // au plus petit ancêtre contenant exactement UN lien de reel.
                const pinnedLinks = new Set();
                for (const icon of document.querySelectorAll('svg[aria-label="Pinned post icon"]')) {
                  let el = icon.parentElement;
                  while (el) {
                    const linksInside = el.querySelectorAll('a[href*="/reel/"]');
                    if (linksInside.length === 1) {
                      pinnedLinks.add(linksInside[0]);
                      break;
                    }
                    if (linksInside.length > 1) break;
                    el = el.parentElement;
                  }
                }

                const grid = Array.from(document.querySelectorAll('a[href*="/reel/"]'))
                  .filter(link => !pinnedLinks.has(link))
                  .map(link => ({ href: link.getAttribute('href'), text: link.innerText.trim() }));

                // 2. Ancien format JSON GraphQL avec play_count.
                const playCounts = [];
                for (const script of document.querySelectorAll('script[type="application/json"]')) {
                  const matches = (script.textContent || '').match(/"play_count":\s*(\d+)/g) || [];
                  for (const m of matches) playCounts.push(parseInt(m.split(':')[1].trim(), 10));
                }

                // 3. Texte global de la page ("277K vues" / "1,2 M de vues").
                return { grid, playCounts, bodyText: document.body.innerText };
              });

              const result = extractInstagramViews(raw, postsLimit);

              if (DEBUG_SCRAPE) console.log(`[IG debug] ${url} → total=${result.total} :`, JSON.stringify(result.counted));

              // Seule la voie 1 (grille) fournit un href par reel, donc un ID
              // exploitable pour le suivi par vidéo (voir extractIdFromHref) —
              // les fallbacks 2/3 n'ont aucun identifiant fiable et sont donc
              // absents de `posts`, ce qui fait retomber history.js sur
              // l'ancien calcul par total brut pour ce compte/ce jour-là.
              const posts = result.counted
                .map(c => ({ id: extractIdFromHref(c.href, /\/reel\/([^/?]+)/), views: c.val }))
                .filter(p => p.id);

              return { total: result.total, posts };
            } finally {
              await igContext.close().catch(() => {});
            }
          });

          igTotal = total;
          igPosts = posts;
          if (error) errors.push({ platform: 'Instagram', message: error });
        }

        // --- TIKTOK ---
        else if (url.includes('tiktok.com')) {
          const { total, posts, error } = await scrapeWithRetry('TikTok', async () => {
            // TikTok bloque Playwright derrière un captcha slider (testé le
            // 08/08/2026), et l'ancien fournisseur d'API tiers (tiktokapi.store)
            // a disparu en septembre 2026 : yt-dlp liste les dernières vidéos
            // du compte avec leurs vues, sans navigateur (voir src/tiktok.js).
            //
            // Même rythme que YouTube (autre plateforme scrapée sans session
            // connectée) : une vingtaine de comptes enchaînés sans pause
            // ressemblent à une rafale automatisée.
            await randomDelay(3000, 8000);

            const result = await fetchTikTokPosts(url, postsLimit);

            if (DEBUG_SCRAPE) console.log(`[TikTok debug] ${url} → total=${result.total} :`, JSON.stringify(result.posts));

            return result;
          });

          ttTotal = total;
          ttPosts = posts;
          if (error) errors.push({ platform: 'TikTok', message: error });
        }

        // --- YOUTUBE ---
        else if (url.includes('youtube.com')) {
          const { total, posts, error } = await scrapeWithRetry('YT', async () => {
            await randomDelay(3000, 8000);

            const ytContext = await browser.newContext({
              userAgent: randomUserAgent(),
              viewport: randomViewport(),
              locale: 'fr-FR',
              timezoneId: 'Europe/Paris',
              extraHTTPHeaders: { referer: randomReferer() }
            });
            await blockHeavyResources(ytContext);
            await randomizeHardwareFingerprint(ytContext);

            try {
              await ytContext.addCookies([
                { name: 'SOCS', value: 'CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzEaAmZyIAEaBgiAo_CmBg', domain: '.youtube.com', path: '/' },
                { name: 'CONSENT', value: 'YES+cb.20210328-17-p0.fr+FX+678', domain: '.youtube.com', path: '/' }
              ]);

              const page = await ytContext.newPage();
              const cleanUrl = url.replace(/\/$/, '');

              // Warm-up : on visite d'abord la page d'accueil de la chaîne,
              // avant l'onglet Shorts.
              await warmUp(page, cleanUrl);
              await page.goto(`${cleanUrl}/shorts`, { waitUntil: 'domcontentloaded', timeout: 25000 });

              // Le bandeau de consentement cookies peut apparaître malgré les
              // cookies pré-injectés (format YouTube changeant selon la
              // localisation/les campagnes) et masquer le contenu en dessous.
              // On tente de le fermer s'il est présent, sans bloquer sinon.
              try {
                const consentButton = page
                  .locator('button:has-text("Tout accepter"), button:has-text("Accept all")')
                  .first();
                await consentButton.waitFor({ state: 'visible', timeout: 3000 });
                await consentButton.click();
                await randomDelay(500, 1200);
              } catch {
                // Pas de bandeau détecté dans le délai, on continue normalement.
              }

              // On attend l'apparition d'au moins une vignette de short plutôt
              // qu'un délai fixe, qui pouvait être trop court sur un rendu lent.
              await page
                .waitForSelector('ytm-shorts-lockup-view-model, ytd-rich-item-renderer', { timeout: 15000 })
                .catch(() => {});

              // Petit scroll pour déclencher le rendu différé des métadonnées
              // (vues) sur les shorts affichés.
              await page.evaluate(() => window.scrollBy(0, 800));
              await randomDelay(1000, 2000);
              await simulateHumanBehavior(page);

              // Comme pour Instagram : relevé brut dans le navigateur,
              // conversion côté Node (voir parseViews.js). Sur YouTube en
              // français, un Short au-delà du million affiche "1,2 M de
              // vues" — format qui n'était pas reconnu avant, et faisait
              // sauter le Short le plus viral du compte.
              const raw = await page.evaluate(() => {
                // 1. Grille des shorts : chaque item est un
                // <ytm-shorts-lockup-view-model> dont le texte contient
                // "X vues", et dont un lien interne pointe vers
                // "/shorts/VIDEO_ID" — cet ID sert au suivi par vidéo.
                const items = Array.from(document.querySelectorAll('ytm-shorts-lockup-view-model')).map(item => {
                  const link = item.querySelector('a[href*="/shorts/"]');
                  return { href: link ? link.getAttribute('href') : null, text: item.innerText };
                });

                // 2. Fallback : ancienne structure générique par span (aucun
                // lien fiable vers la vidéo dans ce cas, donc pas d'ID).
                const spans = Array.from(document.querySelectorAll('span'))
                  .map(s => s.innerText)
                  .filter(t => t && /vue|views/i.test(t));

                return { items, spans };
              });

              const result = extractYouTubeViews(raw, postsLimit);

              if (DEBUG_SCRAPE) console.log(`[YT debug] ${url} → total=${result.total} :`, JSON.stringify(result.counted));

              const posts = result.counted
                .map(c => ({ id: extractIdFromHref(c.href, /\/shorts\/([^/?]+)/), views: c.val }))
                .filter(p => p.id);

              return { total: result.total, posts };
            } finally {
              await ytContext.close().catch(() => {});
            }
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
  } finally {
    await browser.close();
  }
}
