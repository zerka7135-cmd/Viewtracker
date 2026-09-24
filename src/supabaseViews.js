import { loadHistory, computeGrowth24h } from './history.js';
import { loadCumulativeViews } from './cumulativeViews.js';

// Envoi des vues vers l'app Lovable (Clipper HQ). Sans accès direct à sa base
// Supabase (Lovable Cloud ne donne pas la clé secrète), le bot passe par une
// Edge Function de l'app, `ingest-views` (code dans supabase/lovable-prompt.md),
// qui écrit dans deux tables :
//
//   daily_views    (account_name, day) -> vues gagnées ce jour-là, par plateforme
//   account_views  (account_name)      -> cumul all-time (celui du classement ♾️ Discord)
//
// La fonction relie elle-même chaque compte à son clipper (discord_name).
// Configuration : SUPABASE_URL (projet de l'app) et VIEWS_INGEST_SECRET (même
// valeur que le secret de la fonction). Tout l'historique est renvoyé à chaque
// fois et les lignes sont remplacées, jamais additionnées : un envoi raté est
// rattrapé au suivant.

const BATCH_SIZE = 500;
const REQUEST_TIMEOUT_MS = 30_000;

export function isViewsPushConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.VIEWS_INGEST_SECRET);
}

function functionUrl() {
  const url = new URL('/functions/v1/ingest-views', process.env.SUPABASE_URL);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('SUPABASE_URL doit être en https');
  return url;
}

async function send(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const res = await fetch(functionUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.VIEWS_INGEST_SECRET },
      body: JSON.stringify({ table, rows: rows.slice(i, i + BATCH_SIZE) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`${table} : HTTP ${res.status} ${detail}`);
    }
  }
}

/** Lignes daily_views : gain de chaque collecte par rapport à la précédente. */
export function buildDailyViewsRows(history) {
  const rows = [];
  history.forEach((entry, index) => {
    if (index === 0) return; // pas de référence pour la toute première collecte
    const growth = computeGrowth24h(history.slice(0, index), entry.accounts);
    for (const [account, g] of growth) {
      rows.push({ account_name: account, day: entry.date, views: g.total, views_ig: g.ig, views_tt: g.tt, views_yt: g.yt });
    }
  });
  return rows;
}

/** Lignes account_views : cumul all-time par compte. */
export function buildAccountViewsRows(cumulative) {
  const updatedAt = new Date().toISOString();
  return Object.entries(cumulative).map(([account, v]) => ({
    account_name: account,
    total: v.total || 0,
    ig: v.ig || 0,
    tt: v.tt || 0,
    yt: v.yt || 0,
    updated_at: updatedAt
  }));
}

/**
 * Envoie tout l'historique des vues à l'app Lovable. Ne lève jamais : une
 * panne de l'app ne doit bloquer ni la collecte ni Discord.
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function pushViewsToSupabase() {
  if (!isViewsPushConfigured()) return { ok: false, message: 'Envoi des vues non configuré (SUPABASE_URL / VIEWS_INGEST_SECRET)' };
  try {
    const daily = buildDailyViewsRows(loadHistory());
    const totals = buildAccountViewsRows(loadCumulativeViews());
    await send('daily_views', daily);
    await send('account_views', totals);

    const message = `${daily.length} ligne(s) de vues et ${totals.length} cumul(s) envoyés à l'app Lovable`;
    console.log(message);
    return { ok: true, message };
  } catch (error) {
    const message = error.name === 'TimeoutError' ? 'L\'app Lovable ne répond pas (délai dépassé)' : error.message;
    console.error('Envoi des vues vers l\'app Lovable en échec :', message);
    return { ok: false, message };
  }
}
