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
 * Exécute `scrapeFn` (qui doit renvoyer un total de vues) avec une nouvelle
 * tentative en cas d'échec (exception ou total à 0) : un échec ponctuel
 * (rendu lent, bandeau de consentement raté, léger ralentissement réseau)
 * ne fait alors pas remonter une fausse alerte "sélecteurs obsolètes".
 * @returns {{ total: number, error: string|null }}
 */
async function scrapeWithRetry(platform, scrapeFn, attempts = 2) {
  let lastMessage = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const total = await scrapeFn();
      if (total > 0) return { total, error: null };
      lastMessage = 'Aucune vue détectée (page inattendue ou sélecteurs obsolètes)';
    } catch (e) {
      console.error(`Erreur ${platform} (tentative ${attempt}/${attempts}) :`, e.message);
      lastMessage = e.message;
    }

    if (attempt < attempts) await randomDelay(2000, 5000);
  }

  return { total: 0, error: lastMessage };
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
      let igTotal = 0;
      let ttTotal = 0;
      let ytTotal = 0;
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

       // --- INSTAGRAM ---
        if (url.includes('instagram.com')) {
          const { total, error } = await scrapeWithRetry('IG', async () => {
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
              await simulateHumanBehavior(page);

              return await page.evaluate(() => {
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

                // 1. Grille des reels : chaque vignette est un <a href=".../reel/..."> dont
                // le innerText est directement le nombre de vues (ex. "277K"). C'est la
                // structure actuelle de la page (remplace l'ancien affichage "277K vues").
                // Les reels épinglés (badge "Pinned post icon") sont ignorés : ils ne
                // reflètent pas l'activité récente et fausseraient la moyenne des 5 derniers.
                const reelLinks = Array.from(document.querySelectorAll('a[href*="/reel/"]'));
                for (const link of reelLinks) {
                  const article = link.closest('div._ac7v') || link.parentElement;
                  const isPinned = !!article.querySelector('svg[aria-label="Pinned post icon"]');
                  if (isPinned) continue;

                  const text = link.innerText.trim();
                  if (/^[\d.,]+[kKmM]?$/.test(text)) {
                    total += parseCount(text);
                    count++;
                    if (count === 5) break;
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
                            if (count === 5) break;
                          }
                        }
                      }
                    }
                    if (count === 5) break;
                  }
                }

                // 3. Fallback : recherche textuelle globale ("277K vues" / "277K views").
                if (total === 0) {
                  const bodyText = document.body.innerText;
                  const matches = bodyText.match(/([\d.,]+[kKmM]?)\s*(?:vues|views|plays)/g);
                  if (matches) {
                    for (const m of matches.slice(0, 5)) {
                      const raw = m.replace(/vues|views|plays|\s/g, '');
                      total += parseCount(raw);
                    }
                  }
                }

                return total;
              });
            } finally {
              await igContext.close().catch(() => {});
            }
          });

          igTotal = total;
          if (error) errors.push({ platform: 'Instagram', message: error });
        }

        // --- TIKTOK ---
        else if (url.includes('tiktok.com')) {
          const { total, error } = await scrapeWithRetry('TikTok', async () => {
            // Même délai qu'Instagram : TikTok s'est montré tout aussi
            // sensible au rythme des requêtes depuis qu'il bloque la grille
            // de vidéos pour les sessions jugées suspectes.
            await randomDelay(5000, 15000);

            const ttContext = await browser.newContext({
              userAgent: randomUserAgent(),
              viewport: randomViewport(),
              locale: 'fr-FR',
              timezoneId: 'Europe/Paris',
              extraHTTPHeaders: { referer: randomReferer() }
            });
            await blockHeavyResources(ttContext);
            await randomizeHardwareFingerprint(ttContext);

            // Une session connectée est nécessaire depuis que TikTok bloque la
            // grille de vidéos pour les visiteurs anonymes (mur "Comptes
            // suggérés" affiché à la place). Comme pour Instagram, on lit les
            // cookies depuis une variable d'env (Railway) ou un fichier local.
            if (process.env.TIKTOK_COOKIES_JSON) {
              const cookies = JSON.parse(process.env.TIKTOK_COOKIES_JSON);
              await ttContext.addCookies(cookies);
            } else {
              const cookiesPath = process.env.TIKTOK_COOKIES_PATH || './src/tiktok-cookies.json';
              if (fs.existsSync(cookiesPath)) {
                const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
                await ttContext.addCookies(cookies);
              }
            }

            try {
              const page = await ttContext.newPage();

              // Warm-up : passage par une page générique avant le profil ciblé,
              // variée entre accueil et explore pour ne pas suivre un chemin fixe.
              const warmUpUrl = Math.random() < 0.5
                ? 'https://www.tiktok.com/'
                : 'https://www.tiktok.com/explore';
              await warmUp(page, warmUpUrl);
              await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
              await page.waitForTimeout(2000);
              await simulateHumanBehavior(page);

              return await page.evaluate(() => {
                // Les vidéos épinglées portent le texte "Pinned" dans leur bloc
                // (ex. "486.7K\nPinned") : on les ignore, comme pour Instagram,
                // pour ne pas fausser la mesure d'activité récente.
                const items = Array.from(document.querySelectorAll('[data-e2e="user-post-item"]'));
                let sum = 0;
                let count = 0;
                for (const item of items) {
                  if (/pinned/i.test(item.innerText)) continue;

                  const strong = item.querySelector('strong');
                  if (!strong) continue;

                  let val = strong.innerText.trim();
                  let mult = 1;
                  if (/k/i.test(val)) { mult = 1000; val = val.replace(/k/i, ''); }
                  if (/m/i.test(val)) { mult = 1000000; val = val.replace(/m/i, ''); }
                  // Sans suffixe K/M, la virgule est un séparateur de milliers
                  // (ex. "12,595" = 12595), pas un séparateur décimal.
                  val = mult === 1 ? val.replace(/,/g, '') : val.replace(',', '.');
                  const parsed = parseFloat(val);
                  if (!isNaN(parsed)) {
                    sum += Math.round(parsed * mult);
                    count++;
                    if (count === 5) break;
                  }
                }
                return sum;
              });
            } finally {
              await ttContext.close().catch(() => {});
            }
          });

          ttTotal = total;
          if (error) errors.push({ platform: 'TikTok', message: error });
        }

        // --- YOUTUBE ---
        else if (url.includes('youtube.com')) {
          const { total, error } = await scrapeWithRetry('YT', async () => {
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

              return await page.evaluate(() => {
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

                // 1. Grille des shorts : chaque item est un
                // <ytm-shorts-lockup-view-model> dont le texte contient
                // "X views" (ex. "Check out my business...\n11K views").
                const items = Array.from(document.querySelectorAll('ytm-shorts-lockup-view-model'));
                for (const item of items) {
                  const val = parseViews(item.innerText);
                  if (val > 0) {
                    sum += val;
                    count++;
                    if (count === 5) break;
                  }
                }

                // 2. Fallback : ancienne structure générique par span, au cas où
                // la chaîne n'a pas de Shorts ou que la page rend différemment.
                if (count === 0) {
                  const spans = Array.from(document.querySelectorAll('span')).filter(s => s.innerText && /vue|views/i.test(s.innerText));
                  for (const el of spans) {
                    const val = parseViews(el.innerText.trim());
                    if (val > 0) {
                      sum += val;
                      count++;
                      if (count === 5) break;
                    }
                  }
                }

                return sum;
              });
            } finally {
              await ytContext.close().catch(() => {});
            }
          });

          ytTotal = total;
          if (error) errors.push({ platform: 'YouTube', message: error });
        }
      }

      summary.push({
        account: user.name,
        ig: igTotal,
        tt: ttTotal,
        yt: ytTotal,
        total: igTotal + ttTotal + ytTotal,
        errors
      });
    }

    return summary;
  } finally {
    await browser.close();
  }
}
