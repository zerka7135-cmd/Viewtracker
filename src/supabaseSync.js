import path from 'path';
import { loadAccounts, setAccountRate } from './accountsStore.js';
import { upsertClicks, upsertLinkClicks } from './clicksStore.js';
import { todayKey } from './history.js';
import { readJson, writeJsonAtomic } from './jsonStore.js';

// Synchronisation des clics, formulaires remplis (opt-ins) et cash depuis la
// base Supabase de l'app « Clipper HQ » (alimentée par Trakyo) : le bot lit
// trois tables, en lecture seule, et recopie les totaux quotidiens dans sa
// propre base (voir clicksStore.js) :
//
//   clippers          (id, discord_name, rate_click)              -> compte suivi du même nom, tarif par clic
//   daily_stats       (clipper_id, day, clicks, optins, cash)     -> clics / formulaires / cash par jour
//   daily_link_stats  (clipper_id, day, link_name, clicks)        -> clics par lien
//
// Le clipper est relié au compte suivi par son nom (discord_name = nom du
// compte, sans tenir compte de la casse). Configuration : SUPABASE_URL et
// SUPABASE_KEY (clé serveur en lecture — jamais exposée au navigateur).
// Rejouer une synchronisation est sans risque : chaque jour est remplacé, pas
// additionné.

export const SYNC_STATUS_PATH = process.env.SYNC_STATUS_PATH || path.resolve('./data/sync-status.json');

const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isSyncConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
}

/** Dernier résultat de synchronisation (jamais la clé) + état de configuration. */
export function getSyncStatus() {
  const last = readJson(SYNC_STATUS_PATH, null, 'Statut de synchronisation');
  return { configured: isSyncConfigured(), running, last };
}

let running = false;

// Une seule synchronisation à la fois : le bouton « Actualiser » et le
// planning automatique ne doivent pas s'enchevêtrer.
function baseUrl() {
  const url = new URL(process.env.SUPABASE_URL);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('SUPABASE_URL doit être en https');
  return url;
}

async function fetchAll(table, params) {
  const url = baseUrl();
  const rows = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL(`/rest/v1/${table}`, url);
    for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, value);

    const res = await fetch(endpoint, {
      headers: {
        apikey: process.env.SUPABASE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        'Range-Unit': 'items'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`Supabase ${table} : HTTP ${res.status}`);

    const page = await res.json();
    if (!Array.isArray(page)) throw new Error(`Supabase ${table} : réponse inattendue`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

const nameKey = (name) => String(name ?? '').trim().toLowerCase();

/**
 * Recopie dans la base locale les `days` derniers jours de Supabase.
 * Ne lève jamais : le résultat (réussite ou échec) est renvoyé et enregistré
 * dans le statut, pour l'affichage dans Gestion.
 * @returns {Promise<{ok: boolean, message: string, ranAt: string, days: number, rows: number, links: number, matched: number, unmatched: string[]}>}
 */
export async function syncFromSupabase({ days = 7 } = {}) {
  const status = { ok: false, message: '', ranAt: new Date().toISOString(), days, rows: 0, links: 0, matched: 0, unmatched: [] };

  if (!isSyncConfigured()) {
    status.message = 'Supabase non configuré (SUPABASE_URL / SUPABASE_KEY)';
    return status;
  }
  if (running) {
    status.message = 'Une synchronisation est déjà en cours';
    return status;
  }

  running = true;
  try {
    const [y, m, d] = todayKey().split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, d) - days * DAY_MS).toISOString().slice(0, 10);

    const [clippers, stats, linkStats] = await Promise.all([
      fetchAll('clippers', { select: 'id,discord_name,rate_click', order: 'id.asc' }),
      fetchAll('daily_stats', { select: 'clipper_id,day,clicks,optins,cash', day: `gte.${from}`, order: 'day.asc,clipper_id.asc' }),
      fetchAll('daily_link_stats', { select: 'clipper_id,day,link_name,clicks', day: `gte.${from}`, order: 'day.asc,clipper_id.asc,link_name.asc' })
    ]);

    const accounts = loadAccounts();
    const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a]));

    // clipper Supabase -> compte suivi (par le nom)
    const accountByClipper = new Map();
    const unmatched = [];
    for (const clipper of clippers) {
      const account = accountByName.get(nameKey(clipper.discord_name));
      if (account) accountByClipper.set(clipper.id, { account, rate: Number(clipper.rate_click) });
      else unmatched.push(String(clipper.discord_name));
    }

    // Tarif par clic : repris de Supabase seulement pour les comptes qui n'en
    // ont pas encore un propre (un tarif modifié ici n'est jamais écrasé).
    for (const { account, rate } of accountByClipper.values()) {
      if (Number.isFinite(rate) && rate > 0 && !Number.isFinite(account.rateClick)) setAccountRate(account.name, rate);
    }

    // Un total par (compte, jour) : plusieurs lignes du même jour s'additionnent.
    const daily = new Map();
    for (const r of stats) {
      const match = accountByClipper.get(r.clipper_id);
      if (!match) continue;
      const key = `${match.account.name}|${r.day}`;
      const entry = daily.get(key) || { account: match.account.name, date: r.day, source: 'supabase', clicks: 0, forms: 0, cashCents: 0 };
      entry.clicks += Number(r.clicks) || 0;
      entry.forms += Number(r.optins) || 0;
      entry.cashCents += Math.round((Number(r.cash) || 0) * 100);
      daily.set(key, entry);
    }

    const links = new Map();
    for (const r of linkStats) {
      const match = accountByClipper.get(r.clipper_id);
      if (!match || !r.link_name) continue;
      const key = `${match.account.name}|${r.day}|${r.link_name}`;
      const entry = links.get(key) || { account: match.account.name, date: r.day, link: String(r.link_name), clicks: 0 };
      entry.clicks += Number(r.clicks) || 0;
      links.set(key, entry);
    }

    upsertClicks([...daily.values()]);
    upsertLinkClicks([...links.values()]);

    Object.assign(status, {
      ok: true,
      message: `${daily.size} jour(s) de clics et ${links.size} ligne(s) par lien synchronisés`,
      rows: daily.size,
      links: links.size,
      matched: accountByClipper.size,
      unmatched
    });
  } catch (error) {
    status.message = error.name === 'TimeoutError' ? 'Supabase ne répond pas (délai dépassé)' : error.message;
  } finally {
    running = false;
    try {
      writeJsonAtomic(SYNC_STATUS_PATH, status);
    } catch (error) {
      console.error('Erreur d\'écriture du statut de synchronisation :', error.message);
    }
  }
  return status;
}
