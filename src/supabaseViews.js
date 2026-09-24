import { loadHistory, computeGrowth24h } from './history.js';
import { loadCumulativeViews } from './cumulativeViews.js';
import { isSyncConfigured, baseUrl, fetchAll } from './supabaseSync.js';

// Envoi des vues vers Supabase, pour que l'app Lovable (Clipper HQ) les
// affiche. Deux tables, créées par supabase/views.sql :
//
//   daily_views    (account_name, day) -> vues gagnées ce jour-là, par plateforme
//   account_views  (account_name)      -> cumul all-time (celui du classement ♾️ Discord)
//
// Tout l'historique est renvoyé à chaque fois : les lignes sont remplacées
// (upsert), jamais additionnées, donc un envoi raté est rattrapé au suivant.
// Il faut la clé secrète (service_role) : les tables n'autorisent l'écriture
// qu'à elle.

const BATCH_SIZE = 500;
const REQUEST_TIMEOUT_MS = 30_000;

const nameKey = (name) => String(name ?? '').trim().toLowerCase();

async function upsert(table, onConflict, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const endpoint = new URL(`/rest/v1/${table}`, baseUrl());
    endpoint.searchParams.set('on_conflict', onConflict);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(rows.slice(i, i + BATCH_SIZE)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`Supabase ${table} : HTTP ${res.status} ${detail}`);
    }
  }
}

/** Lignes daily_views : gain de chaque collecte par rapport à la précédente. */
export function buildDailyViewsRows(history, clipperIdByName = new Map()) {
  const rows = [];
  history.forEach((entry, index) => {
    if (index === 0) return; // pas de référence pour la toute première collecte
    const growth = computeGrowth24h(history.slice(0, index), entry.accounts);
    for (const [account, g] of growth) {
      rows.push({
        account_name: account,
        clipper_id: clipperIdByName.get(nameKey(account)) ?? null,
        day: entry.date,
        views: g.total,
        views_ig: g.ig,
        views_tt: g.tt,
        views_yt: g.yt
      });
    }
  });
  return rows;
}

/** Lignes account_views : cumul all-time par compte. */
export function buildAccountViewsRows(cumulative, clipperIdByName = new Map()) {
  const updatedAt = new Date().toISOString();
  return Object.entries(cumulative).map(([account, v]) => ({
    account_name: account,
    clipper_id: clipperIdByName.get(nameKey(account)) ?? null,
    total: v.total || 0,
    ig: v.ig || 0,
    tt: v.tt || 0,
    yt: v.yt || 0,
    updated_at: updatedAt
  }));
}

/**
 * Envoie tout l'historique des vues vers Supabase. Ne lève jamais : une
 * panne Supabase ne doit pas bloquer la collecte ni Discord.
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function pushViewsToSupabase() {
  if (!isSyncConfigured()) return { ok: false, message: 'Supabase non configuré' };
  try {
    const clippers = await fetchAll('clippers', { select: 'id,discord_name', order: 'id.asc' });
    const clipperIdByName = new Map(clippers.map((c) => [nameKey(c.discord_name), c.id]));

    const daily = buildDailyViewsRows(loadHistory(), clipperIdByName);
    const totals = buildAccountViewsRows(loadCumulativeViews(), clipperIdByName);
    await upsert('daily_views', 'account_name,day', daily);
    await upsert('account_views', 'account_name', totals);

    const message = `${daily.length} ligne(s) de vues et ${totals.length} cumul(s) envoyés à Supabase`;
    console.log(message);
    return { ok: true, message };
  } catch (error) {
    const message = error.name === 'TimeoutError' ? 'Supabase ne répond pas (délai dépassé)' : error.message;
    console.error('Envoi des vues vers Supabase en échec :', message);
    return { ok: false, message };
  }
}
