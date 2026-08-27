import fs from 'fs';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { config } from './config.js';

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

export async function buildViewsSummary(accounts = config.accounts) {
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

              const result = await page.evaluate((postsLimit) => {
                function parseCount(raw) {
                  let val = raw.trim();
                  let mult = 1;
                  if (/k/i.test(val)) { mult = 1000; val = val.replace(/k/i, ''); }
                  if (/m/i.test(val)) { mult = 1000000; val = val.replace(/m/i, ''); }

                  // Sans suffixe K/M, la virgule est un séparateur de milliers
                  // (ex. "2,479" = 2479 vues) : la retirer plutôt que la
                  // convertir en point, sinon "2,479" devient 2.479 ≈ 2.
                  val = mult === 1 ? val.replace(/,/g, '') : val.replace(',', '.');

                  const parsed = parseFloat(val);
                  return isNaN(parsed) ? 0 : Math.round(parsed * mult);
                }

                let total = 0;
                let count = 0;
                const counted = []; // Détail des reels comptés, pour diagnostic en cas de chiffre suspect.

                // 1. Grille des reels : chaque vignette est un <a href=".../reel/..."> dont
                // le innerText est directement le nombre de vues (ex. "277K"). C'est la
                // structure actuelle de la page (remplace l'ancien affichage "277K vues").
                // Les reels épinglés (badge "Pinned post icon") sont ignorés : ils ne
                // reflètent pas l'activité récente et fausseraient la moyenne des derniers posts.
                //
                // Attention : le conteneur "div._ac7v" regroupe toute une LIGNE de la
                // grille (3 reels), pas une vignette individuelle — s'y fier directement
                // marque à tort les 2 voisins d'un reel épinglé comme épinglés eux aussi,
                // décalant le calcul vers des reels plus loin dans la grille (bug identifié
                // le 5 août : un compte affichait un total anormalement élevé pour cette
                // raison exacte). À la place, on associe chaque badge "Pinned" au plus
                // petit ancêtre contenant exactement UN lien de reel : c'est ce lien-là,
                // et lui seul, qui est réellement épinglé.
                const pinnedLinks = new Set();
                const pinnedIcons = Array.from(document.querySelectorAll('svg[aria-label="Pinned post icon"]'));
                for (const icon of pinnedIcons) {
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

                const reelLinks = Array.from(document.querySelectorAll('a[href*="/reel/"]'));
                for (const link of reelLinks) {
                  if (pinnedLinks.has(link)) continue;

                  const text = link.innerText.trim();
                  if (/^[\d.,]+[kKmM]?$/.test(text)) {
                    const val = parseCount(text);
                    total += val;
                    count++;
                    counted.push({ href: link.getAttribute('href'), text, val });
                    if (count === postsLimit) break;
                  }
                }

                // 2. Fallback : ancien format JSON GraphQL avec play_count.
                if (total === 0) {
                  const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
                  for (const script of scripts) {
                    if (script.textContent && script.textContent.includes('play_count')) {
                      const matches = script.textContent.match(/"play_count":\s*(\d+)/g);
                      if (matches) {
                        for (const m of matches) {
                          const val = parseInt(m.split(':')[1].trim(), 10);
                          if (!isNaN(val) && val > 0) {
                            total += val;
                            count++;
                            counted.push({ source: 'play_count', val });
                            if (count === postsLimit) break;
                          }
                        }
                      }
                    }
                    if (count === postsLimit) break;
                  }
                }

                // 3. Fallback : recherche textuelle globale ("277K vues" / "277K views").
                if (total === 0) {
                  const bodyText = document.body.innerText;
                  const matches = bodyText.match(/([\d.,]+[kKmM]?)\s*(?:vues|views|plays)/g);
                  if (matches) {
                    for (const m of matches.slice(0, postsLimit)) {
                      const raw = m.replace(/vues|views|plays|\s/g, '');
                      const val = parseCount(raw);
                      total += val;
                      counted.push({ source: 'texte global', text: m, val });
                    }
                  }
                }

                return { total, counted };
              }, config.postsLimit);

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
            // TikTok bloque désormais Playwright derrière un captcha slider
            // ("Drag the slider to fit the puzzle"), reproductible même avec
            // IP résidentielle, navigateur non-headless, cookies frais et
            // patch anti-détection CDP (rebrowser-playwright) — testé le
            // 08/08/2026, les 4 pistes ont échoué. On passe donc par l'API
            // tierce tiktokapi.store (scraping fait côté fournisseur), qui
            // évite complètement le navigateur pour cette plateforme.
            //
            // Court délai avant chaque appel, contrairement à avant : sans lui,
            // les ~20 comptes tapaient l'API en rafale (aucune pause entre eux),
            // ce qui a probablement aggravé la panne du 12/08 où 14 comptes sur
            // 20 ont échoué en "fetch failed" d'un coup — un vrai down côté
            // fournisseur, mais une rafale de requêtes simultanées ne l'aide pas.
            await randomDelay(500, 1500);

            const username = new URL(url).pathname.replace(/^\/@?/, '').replace(/\/$/, '');

            const apiUrl = new URL('https://tiktokapi.store/api/v1/user/posts');
            apiUrl.searchParams.set('unique_id', `@${username}`);
            apiUrl.searchParams.set('count', String(Math.max(10, config.postsLimit * 2))); // marge au-delà de postsLimit pour compenser les vidéos épinglées exclues
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
            // IG/l'ancien scraping TikTok, pour ne pas fausser la mesure
            // d'activité récente.
            const videos = (body.data?.videos || []).filter(v => v.is_top !== 1);
            const counted = videos.slice(0, config.postsLimit).map(v => ({ id: v.video_id, title: v.title, val: v.play_count || 0 }));
            const sum = counted.reduce((acc, v) => acc + v.val, 0);

            if (DEBUG_SCRAPE) console.log(`[TikTok debug] ${url} → total=${sum} :`, JSON.stringify(counted));

            const posts = counted.filter(c => c.id).map(c => ({ id: c.id, views: c.val }));
            return { total: sum, posts };
          // 3 tentatives au lieu des 2 par défaut : la panne du 12/08 était un
          // "fetch failed" réseau côté fournisseur, pas un problème de contenu —
          // une tentative de plus, avec le backoff exponentiel déjà en place,
          // laisse plus de chances à un simple hoquet de passer tout seul.
          }, 3);

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

              const result = await page.evaluate((postsLimit) => {
                function parseViews(txt) {
                  const match = txt.match(/([\d.,]+)\s*([kKmM]?)\s*(?:vues|views)/i);
                  if (!match) return 0;
                  let val = match[1];
                  let mult = 1;
                  if (/k/i.test(match[2])) mult = 1000;
                  if (/m/i.test(match[2])) mult = 1000000;
                  // Sans suffixe K/M, la virgule est un séparateur de milliers
                  // (ex. "12,595" = 12595), pas un séparateur décimal.
                  val = mult === 1 ? val.replace(/,/g, '') : val.replace(',', '.');
                  const parsed = parseFloat(val);
                  return isNaN(parsed) ? 0 : Math.round(parsed * mult);
                }

                let sum = 0;
                let count = 0;
                const counted = []; // Détail par short, avec ID quand dispo (voie 1 seulement).

                // 1. Grille des shorts : chaque item est un
                // <ytm-shorts-lockup-view-model> dont le texte contient
                // "X views" (ex. "Check out my business...\n11K views"), et
                // dont un lien interne pointe vers "/shorts/VIDEO_ID" — c'est
                // cet ID qui sert au suivi par vidéo (voir extractIdFromHref).
                const items = Array.from(document.querySelectorAll('ytm-shorts-lockup-view-model'));
                for (const item of items) {
                  const val = parseViews(item.innerText);
                  if (val > 0) {
                    const link = item.querySelector('a[href*="/shorts/"]');
                    counted.push({ href: link ? link.getAttribute('href') : null, val });
                    sum += val;
                    count++;
                    if (count === postsLimit) break;
                  }
                }

                // 2. Fallback : ancienne structure générique par span, au cas où
                // la chaîne n'a pas de Shorts ou que la page rend différemment.
                // Aucun lien fiable vers la vidéo dans ce cas, donc pas d'ID.
                if (count === 0) {
                  const spans = Array.from(document.querySelectorAll('span')).filter(s => s.innerText && /vue|views/i.test(s.innerText));
                  for (const el of spans) {
                    const val = parseViews(el.innerText.trim());
                    if (val > 0) {
                      counted.push({ href: null, val });
                      sum += val;
                      count++;
                      if (count === postsLimit) break;
                    }
                  }
                }

                return { total: sum, counted };
              }, config.postsLimit);

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
