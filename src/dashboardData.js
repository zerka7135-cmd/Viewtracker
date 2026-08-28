import { loadAccounts } from './accountsStore.js';
import { loadHistory, computeGrowth24h } from './history.js';
import { loadCumulativeViews } from './cumulativeViews.js';

// Transforme les données déjà persistées (accountsStore, history.js,
// cumulativeViews.js — fichiers JSON, voir README) en JSON prêt pour le
// dashboard web (voir server.js) — aucune nouvelle logique de scraping ou
// de calcul de croissance ici, tout est réutilisé tel quel.
//
// Version sans suivi de lien en bio (voir backup/dashboard-rewrite-27-08
// pour la version avec clics) — juste les vues pour l'instant.

const SPARKLINE_POINTS = 7;

function postUrl(platform, id, ttUsername) {
  if (!id) return null;
  if (platform === 'ig') return `https://www.instagram.com/reel/${id}/`;
  if (platform === 'yt') return `https://www.youtube.com/shorts/${id}`;
  if (platform === 'tt') return ttUsername ? `https://www.tiktok.com/@${ttUsername}/video/${id}` : null;
  return null;
}

function extractTiktokUsername(urls) {
  const ttUrl = (urls || []).find((u) => u && u.includes('tiktok.com'));
  if (!ttUrl) return null;
  try {
    return new URL(ttUrl).pathname.replace(/^\/@?/, '').replace(/\/$/, '') || null;
  } catch {
    return null;
  }
}

/**
 * Comptes suivis enrichis des dernières valeurs scrapées, du cumul
 * all-time, d'une sparkline (jusqu'à 7 derniers jours) et des posts les
 * plus récents (pour le tiroir de détail du dashboard).
 * @returns {Array<object>}
 */
export function getAccountsWithStats() {
  const accounts = loadAccounts();
  const history = loadHistory(); // trié du plus ancien au plus récent
  const cumulative = loadCumulativeViews();

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

    // ig/tt/yt/total = cumul all-time (comme le classement ♾️ de Discord,
    // voir embed.js#buildAllTimeEmbed), pas le snapshot brut du jour — sinon
    // le dashboard afficherait une 3e métrique qui n'apparaît nulle part
    // sur Discord (ni le gain 24h, ni l'all-time), prêtant à confusion en
    // comparant les deux. `null` préservé quand la plateforme n'est pas
    // configurée pour ce compte (mêmes règles Ban que Discord), même si le
    // cumul correspondant vaudrait 0 par défaut.
    const cumulOrNull = (platform) => (latest?.[platform] === null ? null : (cumul?.[platform] ?? 0));

    return {
      name: user.name,
      urls: user.urls, // pour l'édition depuis le dashboard (voir AccountsView.jsx)
      alertThreshold: user.alertThreshold ?? null, // pour pré-remplir le champ en édition (voir AddAccountModal.jsx)
      ig: cumulOrNull('ig'),
      tt: cumulOrNull('tt'),
      yt: cumulOrNull('yt'),
      total: cumul?.total ?? 0,
      // Le statut d'avertissement, lui, reste basé sur le snapshot brut du
      // jour (0 vue à la dernière collecte) — c'est un indicateur de santé
      // du scraping, pas une métrique affichée.
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

/** KPIs affichés en haut du dashboard. */
export function getKpis() {
  const accounts = loadAccounts();
  const history = loadHistory();
  const cumulative = loadCumulativeViews();

  const latestEntry = history[history.length - 1] || null;
  const previousHistory = history.slice(0, -1);
  const growth24h = latestEntry ? computeGrowth24h(previousHistory, latestEntry.accounts) : new Map();

  const totalAllTime = Object.values(cumulative).reduce((sum, v) => sum + (v.total || 0), 0);
  const totalGrowth24h = [...growth24h.values()].reduce((sum, g) => sum + g.total, 0);

  const warnings = accounts.filter((user) => {
    const latest = latestEntry?.accounts.find((a) => a.account === user.name);
    return (latest?.total ?? 0) === 0;
  });

  return {
    totalAllTime,
    totalGrowth24h,
    accountsCount: accounts.length,
    warningsCount: warnings.length
  };
}

/**
 * Série quotidienne agrégée (tous comptes confondus) pour le graphique
 * Historique, filtrable par plateforme.
 * @param {number} days
 * @param {'all'|'ig'|'tt'|'yt'} platform
 * @returns {Array<{date: string, value: number}>}
 */
export function getHistorySeries(days = 14, platform = 'all') {
  const history = loadHistory().slice(-days);

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
 * Même série que getHistorySeries ci-dessus, mais pour un seul compte
 * suivi plutôt qu'agrégée — alimente le graphique d'évolution du tiroir de
 * détail (AccountDrawer.jsx). Une date où le compte n'a pas encore de
 * valeur vaut `null` plutôt que 0, pour ne pas laisser croire à une chute
 * de vues.
 * @param {string} accountName
 * @param {number} days
 * @param {'all'|'ig'|'tt'|'yt'} platform
 * @returns {Array<{date: string, value: number|null}>}
 */
export function getAccountHistorySeries(accountName, days = 14, platform = 'all') {
  const history = loadHistory().slice(-days);

  return history.map((entry) => {
    const found = entry.accounts.find((a) => a.account === accountName);
    if (!found) return { date: entry.date, value: null };
    const value = platform === 'all' ? (found.total ?? null) : found[platform];
    return { date: entry.date, value: typeof value === 'number' ? value : null };
  });
}
