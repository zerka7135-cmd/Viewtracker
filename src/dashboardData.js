import { loadAccounts } from './accountsStore.js';
import { loadHistory, computeGrowth24h } from './history.js';
import { loadCumulativeViews } from './cumulativeViews.js';
import { loadBioLinks } from './bioLink.js';
import { config } from './config.js';
import { query } from './db.js';

// Seul endroit qui transforme les données brutes déjà persistées en base
// (accountsStore, history.js, cumulativeViews.js — Postgres, voir
// migrations/003_viewtracker_bot.sql) en JSON prêt pour le dashboard web
// (voir server.js) — aucune nouvelle logique de scraping ou de calcul de
// croissance ici, tout est réutilisé tel quel. Toutes les fonctions
// prennent désormais un `orgId` et sont async (I/O Postgres).

const SPARKLINE_POINTS = 7;

function extractTiktokUsername(urls) {
  const ttUrl = (urls || []).find((u) => u && u.includes('tiktok.com'));
  if (!ttUrl) return null;
  try {
    return new URL(ttUrl).pathname.replace(/^\/@?/, '').replace(/\/$/, '') || null;
  } catch {
    return null;
  }
}

function postUrl(platform, id, ttUsername) {
  if (!id) return null;
  if (platform === 'ig') return `https://www.instagram.com/reel/${id}/`;
  if (platform === 'yt') return `https://www.youtube.com/shorts/${id}`;
  if (platform === 'tt') return ttUsername ? `https://www.tiktok.com/@${ttUsername}/video/${id}` : null;
  return null;
}

/**
 * Comptes suivis enrichis des dernières valeurs scrapées, du cumul
 * all-time, d'une sparkline (jusqu'à 7 derniers jours) et des posts les
 * plus récents (pour le tiroir de détail du dashboard).
 * @param {string} orgId
 * @returns {Promise<Array<object>>}
 */
export async function getAccountsWithStats(orgId) {
  const accounts = await loadAccounts(orgId);
  const history = await loadHistory(orgId); // trié du plus ancien au plus récent
  const cumulative = await loadCumulativeViews(orgId);
  const bioLinks = await loadBioLinks(orgId);

  const latestEntry = history[history.length - 1] || null;
  const previousHistory = history.slice(0, -1);
  const growth24h = latestEntry ? computeGrowth24h(previousHistory, latestEntry.accounts) : new Map();

  const recentEntries = history.slice(-SPARKLINE_POINTS);

  return accounts.map((user) => {
    const latest = latestEntry?.accounts.find((a) => a.account === user.name) || null;
    const cumul = cumulative[user.name] || null;
    const growth = growth24h.get(user.name) || null;
    const ttUsername = extractTiktokUsername(user.urls);

    const spark = recentEntries.map((entry) => {
      const item = entry.accounts.find((a) => a.account === user.name);
      return item?.total ?? 0;
    });

    const postsFor = (platform) =>
      (latest?.posts?.[platform] || []).map((p) => ({
        id: p.id,
        views: p.views,
        url: postUrl(platform, p.id, ttUsername)
      }));

    const bioLink = bioLinks.get(user.name) || { url: null, slug: null, clicks: 0 };

    return {
      name: user.name,
      urls: user.urls, // pour l'édition depuis le dashboard (voir AccountsView.jsx)
      bioLink: {
        url: bioLink.url,
        clicks: bioLink.clicks,
        // Lien trackable complet à coller dans la bio — null tant
        // qu'aucune URL n'a été renseignée (voir bioLink.js#setBioLinkUrl).
        trackedUrl: bioLink.slug ? `${config.publicUrl}/r/${bioLink.slug}` : null
      },
      ig: latest?.ig ?? null,
      tt: latest?.tt ?? null,
      yt: latest?.yt ?? null,
      total: latest?.total ?? 0,
      isWarning: (latest?.total ?? 0) === 0,
      errors: latest?.errors || [],
      allTime: {
        total: cumul?.total ?? 0,
        ig: cumul?.ig ?? 0,
        tt: cumul?.tt ?? 0,
        yt: cumul?.yt ?? 0
      },
      growth24h: growth ? growth.total : 0,
      spark,
      posts: {
        ig: postsFor('ig'),
        tt: postsFor('tt'),
        yt: postsFor('yt')
      }
    };
  });
}

/**
 * KPIs affichés en haut du dashboard.
 * @param {string} orgId
 */
export async function getKpis(orgId) {
  const accounts = await loadAccounts(orgId);
  const history = await loadHistory(orgId);
  const cumulative = await loadCumulativeViews(orgId);
  const bioLinks = await loadBioLinks(orgId);

  const latestEntry = history[history.length - 1] || null;
  const previousHistory = history.slice(0, -1);
  const growth24h = latestEntry ? computeGrowth24h(previousHistory, latestEntry.accounts) : new Map();

  const totalAllTime = Object.values(cumulative).reduce((sum, v) => sum + (v.total || 0), 0);
  const totalGrowth24h = [...growth24h.values()].reduce((sum, g) => sum + g.total, 0);

  const warnings = accounts.filter((user) => {
    const latest = latestEntry?.accounts.find((a) => a.account === user.name);
    return (latest?.total ?? 0) === 0;
  });

  // Vues → clics : mesure la conversion des liens en bio (voir bioLink.js),
  // affichée en mode "Clics" du dashboard (DashboardView.jsx).
  const totalClicks = [...bioLinks.values()].reduce((sum, b) => sum + (b.clicks || 0), 0);
  const linksConfiguredCount = [...bioLinks.values()].filter((b) => b.url).length;
  const conversionRate = totalAllTime > 0 ? (totalClicks / totalAllTime) * 100 : 0;

  return {
    totalAllTime,
    totalGrowth24h,
    accountsCount: accounts.length,
    warningsCount: warnings.length,
    totalClicks,
    linksConfiguredCount,
    conversionRate
  };
}

/**
 * Série quotidienne agrégée (tous comptes confondus) pour le graphique
 * Historique, filtrable par plateforme.
 * @param {string} orgId
 * @param {number} days
 * @param {'all'|'ig'|'tt'|'yt'} platform
 * @returns {Promise<Array<{date: string, value: number}>>}
 */
export async function getHistorySeries(orgId, days = 14, platform = 'all') {
  const history = (await loadHistory(orgId)).slice(-days);

  return history.map((entry) => {
    const value = entry.accounts.reduce((sum, a) => {
      if (platform === 'all') return sum + (a.total || 0);
      const v = a[platform];
      return sum + (typeof v === 'number' ? v : 0);
    }, 0);
    return { date: entry.date, value };
  });
}

/**
 * Série horaire (24 points, une par heure) pour le filtre "24h" — plus
 * fine que getHistorySeries qui n'agrège que par jour. La collecte ne
 * tourne qu'une fois par jour (cron, voir src/scheduler.js), donc la
 * plupart des heures resteront à 0 avec un seul pic à l'heure du scan :
 * c'est la donnée réelle, pas un défaut de cette fonction — un histogramme
 * plat serait trompeur, celui-ci montre honnêtement la fréquence actuelle
 * de collecte.
 * @param {string} orgId
 * @param {'all'|'ig'|'tt'|'yt'} platform
 * @returns {Promise<Array<{date: string, value: number}>>} `date` = ISO horaire (ex. "2026-08-09T14:00")
 */
export async function getHistorySeriesHourly(orgId, platform = 'all') {
  const platformColumn = { ig: 'instagram', tt: 'tiktok', yt: 'youtube' }[platform];

  const { rows } = await query(
    `SELECT date_trunc('hour', s.captured_at) AS hour, sum(s.views) AS total
     FROM snapshots s
     JOIN tracked_accounts ta ON ta.id = s.tracked_account_id
     JOIN creators c ON c.id = ta.creator_id
     WHERE c.organization_id = $1
       AND s.granularity = 'raw'
       AND s.captured_at >= now() - interval '24 hours'
       ${platformColumn ? `AND ta.platform = '${platformColumn}'` : ''}
     GROUP BY hour
     ORDER BY hour`,
    [orgId]
  );

  const byHour = new Map(rows.map((r) => [r.hour.toISOString().slice(0, 13), Number(r.total)]));
  const series = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() - i);
    const key = d.toISOString().slice(0, 13);
    series.push({ date: `${key}:00`, value: byHour.get(key) || 0 });
  }
  return series;
}

/**
 * Même série que getHistorySeries ci-dessus, mais pour un seul compte
 * suivi plutôt qu'agrégée sur toute l'organisation — alimente le
 * graphique d'évolution du tiroir de détail (AccountDrawer.jsx).
 * Une date où le compte n'a pas encore de valeur (pas encore suivi à
 * cette époque, ou collecte manquante) vaut `null` plutôt que 0, pour ne
 * pas laisser croire à une chute de vues.
 * @param {string} orgId
 * @param {string} accountName
 * @param {number} days
 * @param {'all'|'ig'|'tt'|'yt'} platform
 * @returns {Promise<Array<{date: string, value: number|null}>>}
 */
export async function getAccountHistorySeries(orgId, accountName, days = 14, platform = 'all') {
  const history = (await loadHistory(orgId)).slice(-days);

  return history.map((entry) => {
    const found = entry.accounts.find((a) => a.account === accountName);
    if (!found) return { date: entry.date, value: null };
    const value = platform === 'all' ? (found.total ?? null) : found[platform];
    return { date: entry.date, value: typeof value === 'number' ? value : null };
  });
}
