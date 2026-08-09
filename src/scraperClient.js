// Client HTTP vers scraper-service (Python/Scrapling, voir
// scraper-service/main.py) : remplace l'ancien scraping Playwright inline
// pour Instagram et YouTube (src/instagram.js). Le contrat de retour
// { total, posts, error } est celui attendu par scrapeWithRetry — cette
// fonction lève une exception en cas d'échec réseau/HTTP ou d'erreur
// remontée par le service, exactement comme le faisait le code Playwright
// qu'elle remplace.

import { config } from './config.js';

const BASE_URL = config.scraperServiceUrl;
const TOKEN = process.env.SCRAPER_SERVICE_TOKEN;

// Le scraping d'une page réelle (navigateur piloté par Scrapling) peut
// prendre du temps : timeout large plutôt qu'un défaut trop court qui
// ferait échouer des scrapes par ailleurs valides.
const REQUEST_TIMEOUT_MS = 45000;

async function callScraper(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { 'X-Scraper-Token': TOKEN } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!res.ok) {
    throw new Error(`scraper-service a répondu ${res.status} pour ${path}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);

  return { total: data.total, posts: data.posts || [] };
}

/**
 * Scrape un profil Instagram via scraper-service. `cookies` = le même
 * tableau de cookies de session que celui lu depuis IG_COOKIES_JSON ou
 * src/ig-cookies.json (voir buildViewsSummary dans src/instagram.js).
 * @returns {Promise<{total: number, posts: Array<{id: string, views: number}>}>}
 */
export function scrapeInstagram(url, postsLimit, cookies) {
  return callScraper('/scrape/instagram', { url, postsLimit, cookies: cookies || [] });
}

/**
 * Scrape la page Shorts d'une chaîne YouTube via scraper-service.
 * @returns {Promise<{total: number, posts: Array<{id: string, views: number}>}>}
 */
export function scrapeYoutube(url, postsLimit) {
  return callScraper('/scrape/youtube', { url, postsLimit });
}
