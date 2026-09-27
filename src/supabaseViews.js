import fs from 'fs';
import { loadHistory, computeGrowth24h, HISTORY_PATH } from './history.js';
import { loadCumulativeViews } from './cumulativeViews.js';

// Envoi des vues vers l'app Lovable (Clipper HQ). Sans accès direct à sa base
// Supabase (Lovable Cloud ne donne pas la clé secrète), le bot passe par une
// route de réception de l'app, `ingest-views` (voir supabase/lovable-prompt.md),
// qui écrit dans deux tables :
//
//   daily_views    (account_name, day) -> vues gagnées ce jour-là, par plateforme
//   account_views  (account_name)      -> cumul all-time (celui du classement ♾️ Discord)
//
// La route relie elle-même chaque compte à son clipper (discord_name).
// Configuration : VIEWS_INGEST_URL (adresse de réception de l'app ; à défaut,
// la fonction ingest-views du projet SUPABASE_URL) et VIEWS_INGEST_SECRET (même
// valeur que le secret côté app). Tout l'historique est renvoyé à chaque
// fois et les lignes sont remplacées, jamais additionnées : un envoi raté est
// rattrapé au suivant.

const BATCH_SIZE = 500;
const REQUEST_TIMEOUT_MS = 30_000;

export function isViewsPushConfigured() {
  return Boolean((process.env.VIEWS_INGEST_URL || process.env.SUPABASE_URL) && process.env.VIEWS_INGEST_SECRET);
}

function functionUrl() {
  const url = process.env.VIEWS_INGEST_URL
    ? new URL(process.env.VIEWS_INGEST_URL)
    : new URL('/functions/v1/ingest-views', process.env.SUPABASE_URL);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('L\'adresse de réception des vues doit être en https');
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

// Au-delà de ce nombre de jours entre deux collectes (bot arrêté,
// migration...), le gain rattrapé est réparti sur les jours du trou au lieu
// de tomber en entier sur le jour de la collecte. Ce sont des estimations
// (estimated: true) ; le total est inchangé.
const GAP_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (key, n) => dayKey(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS);

/** Jour de publication lu dans l'identifiant (TikTok, Instagram) ; YouTube : null. */
export function publishedDay(platform, id) {
  try {
    if (platform === 'tt') return dayKey(Number(BigInt(id) >> 32n) * 1000);
    if (platform === 'ig') {
      let n = 0n;
      for (const c of String(id).slice(0, 11)) {
        const v = B64.indexOf(c);
        if (v < 0) return null;
        n = n * 64n + BigInt(v);
      }
      return dayKey(Number(n >> 23n) + 1314220021721);
    }
  } catch {
    // identifiant inattendu : date inconnue
  }
  return null;
}

/**
 * Répartit `total` sur `days` : chaque vidéo pèse ses vues gagnées, étalées
 * de sa date de publication (bornée au trou) jusqu'au dernier jour ; les vues
 * des vidéos déjà suivies et celles sans date sont étalées sur tout le trou.
 */
function spread(total, days, platform, currentPosts, previousPosts) {
  const weights = new Array(days.length).fill(0);
  const previous = new Map((previousPosts || []).map((p) => [p.id, p.views]));
  for (const post of currentPosts || []) {
    const gained = previous.has(post.id) ? Math.max(0, post.views - previous.get(post.id)) : post.views;
    const published = previous.has(post.id) ? null : publishedDay(platform, post.id);
    let from = 0;
    if (published) {
      const i = days.findIndex((d) => d >= published);
      from = i === -1 ? days.length - 1 : i;
    }
    for (let i = from; i < days.length; i++) weights[i] += gained / (days.length - from);
  }
  const sum = weights.reduce((s, w) => s + w, 0);
  const shares = sum > 0 ? weights.map((w) => w / sum) : weights.map(() => 1 / days.length);
  const alloc = shares.map((sh) => Math.floor(total * sh));
  alloc[alloc.length - 1] += total - alloc.reduce((s, v) => s + v, 0);
  return alloc;
}

/** Lignes daily_views : gain de chaque collecte par rapport à la précédente. */
export function buildDailyViewsRows(history) {
  const rows = [];
  history.forEach((entry, index) => {
    if (index === 0) return; // pas de référence pour la toute première collecte
    const growth = computeGrowth24h(history.slice(0, index), entry.accounts, entry.date);
    const previousEntry = history[index - 1];
    const days = [];
    for (let d = addDays(previousEntry.date, 1); d <= entry.date; d = addDays(d, 1)) days.push(d);

    for (const [account, g] of growth) {
      if (days.length < GAP_DAYS) {
        rows.push({ account_name: account, day: entry.date, views: g.total, views_ig: g.ig, views_tt: g.tt, views_yt: g.yt });
        continue;
      }
      const current = entry.accounts.find((a) => a.account === account);
      const previous = previousEntry.accounts.find((a) => a.account === account);
      const per = Object.fromEntries(['ig', 'tt', 'yt'].map((k) => [k, spread(g[k], days, k, current?.posts?.[k], previous?.posts?.[k])]));
      days.forEach((day, i) => {
        const ig = per.ig[i];
        const tt = per.tt[i];
        const yt = per.yt[i];
        rows.push({ account_name: account, day, views: ig + tt + yt, views_ig: ig, views_tt: tt, views_yt: yt, estimated: true });
      });
    }
  });
  return rows;
}

/** Lignes account_views : cumul all-time par compte. */
export function buildAccountViewsRows(cumulative, updatedAt = new Date().toISOString()) {
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
  if (!isViewsPushConfigured()) return { ok: false, message: 'Envoi des vues non configuré (VIEWS_INGEST_URL / VIEWS_INGEST_SECRET)' };
  try {
    const daily = buildDailyViewsRows(loadHistory());
    // updated_at = heure de la dernière collecte (écriture de history.json),
    // pas celle de l'envoi : un redémarrage renvoie les données sans les rajeunir.
    const totals = buildAccountViewsRows(loadCumulativeViews(), fs.statSync(HISTORY_PATH).mtime.toISOString());
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
