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
    args: ['--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    // Ordre des comptes randomisé à chaque exécution : évite de reproduire
    // exactement le même schéma de navigation jour après jour.
    const shuffledAccounts = shuffle(accounts);

    for (const user of shuffledAccounts) {
      let igTotal = 0;
      let ttTotal = 0;
      let ytTotal = 0;
      const errors = []; // Trace des échecs de scraping pour ce compte (visible dans le résumé)

      for (const url of user.urls) {

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
              locale: 'fr-FR'
            });
            await blockHeavyResources(igContext);

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

              return await page.evaluate(() => {
                function parseCount(raw) {
                  let val = raw.trim().replace(',', '.');
                  let mult = 1;
                  if (/k/i.test(val)) { mult = 1000; val = val.replace(/k/i, ''); }
                  if (/m/i.test(val)) { mult = 1000000; val = val.replace(/m/i, ''); }
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
            await randomDelay(3000, 8000);

            const ttContext = await browser.newContext({
              userAgent: randomUserAgent(),
              viewport: randomViewport(),
              locale: 'fr-FR'
            });
            await blockHeavyResources(ttContext);

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

              // Warm-up : passage par la page d'accueil TikTok avant le profil ciblé.
              await warmUp(page, 'https://www.tiktok.com/');
              await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
              await page.waitForTimeout(2000);

              return await page.evaluate(() => {
                const views = Array.from(document.querySelectorAll('[data-e2e="user-post-item"] strong'));
                let sum = 0;
                for (const v of views.slice(0, 5)) {
                  let val = v.innerText.trim().replace(',', '.');
                  let mult = 1;
                  if (/k/i.test(val)) { mult = 1000; val = val.replace(/k/i, ''); }
                  if (/m/i.test(val)) { mult = 1000000; val = val.replace(/m/i, ''); }
                  const parsed = parseFloat(val);
                  if (!isNaN(parsed)) sum += Math.round(parsed * mult);
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
              locale: 'fr-FR'
            });
            await blockHeavyResources(ytContext);

            try {
              await ytContext.addCookies([
                { name: 'SOCS', value: 'CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzEaAmZyIAEaBgiAo_CmBg', domain: '.youtube.com', path: '/' },
                { name: 'CONSENT', value: 'YES+cb.20210328-17-p0.fr+FX+678', domain: '.youtube.com', path: '/' }
              ]);

              const page = await ytContext.newPage();
              const cleanUrl = url.replace(/\/$/, '');

              // Warm-up : on visite d'abord la page d'accueil de la chaîne,
              // avant l'onglet Vidéos.
              await warmUp(page, cleanUrl);
              await page.goto(`${cleanUrl}/videos`, { waitUntil: 'domcontentloaded', timeout: 25000 });

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

              // On attend l'apparition d'au moins une vignette de vidéo plutôt
              // qu'un délai fixe, qui pouvait être trop court sur un rendu lent.
              await page
                .waitForSelector('ytd-rich-item-renderer, ytd-grid-video-renderer', { timeout: 15000 })
                .catch(() => {});

              // Petit scroll pour déclencher le rendu différé des métadonnées
              // (vues) sur les vidéos affichées.
              await page.evaluate(() => window.scrollBy(0, 800));
              await randomDelay(1000, 2000);

              return await page.evaluate(() => {
                const spans = Array.from(document.querySelectorAll('span')).filter(s => s.innerText && /vue|views/i.test(s.innerText));
                let sum = 0;
                let count = 0;

                for (const el of spans) {
                  let txt = el.innerText.trim();
                  let val = txt.split('vue')[0].split('view')[0].trim().replace(/\s/g, '').replace(',', '.');
                  let mult = 1;
                  if (/k/i.test(val)) { mult = 1000; val = val.replace(/k/i, ''); }
                  if (/m/i.test(val)) { mult = 1000000; val = val.replace(/m/i, ''); }

                  const parsed = parseFloat(val);
                  if (!isNaN(parsed) && parsed > 0) {
                    sum += Math.round(parsed * mult);
                    count++;
                    if (count === 5) break;
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
