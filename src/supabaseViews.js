import fs from 'fs';
import { loadHistory, computeGrowth24h, HISTORY_PATH } from './history.js';
import { loadCumulativeViews } from './cumulativeViews.js';
import { loadAccounts } from './accountsStore.js';

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

// Quand deux collectes sont espacées de plus d'un jour (bot arrêté,
// migration, collecte manquée...), le gain rattrapé est réparti sur les jours
// du trou au lieu de tomber en entier sur le jour de la collecte. Ce sont des
// estimations (estimated: true) ; le total est inchangé.
const GAP_DAYS = 2;
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

const isNew = (previous, post) => !previous.has(post.id);

/** Poids par jour des vidéos nouvelles datées : étalées de leur publication au dernier jour. */
function datedWeights(days, platform, currentPosts, previousPosts) {
  const weights = new Array(days.length).fill(0);
  const previous = new Map((previousPosts || []).map((p) => [p.id, p.views]));
  for (const post of currentPosts || []) {
    const published = isNew(previous, post) ? publishedDay(platform, post.id) : null;
    if (!published) continue;
    const i = days.findIndex((d) => d >= published);
    const from = i === -1 ? days.length - 1 : i;
    for (let j = from; j < days.length; j++) weights[j] += post.views / (days.length - from);
  }
  return weights;
}

/**
 * Répartit `total` sur `days`. Vidéos nouvelles datées : de leur publication
 * au dernier jour. Vidéos nouvelles sans date (YouTube) : même rythme que
 * les vidéos datées du compte sur ce trou (`profile`), sinon uniformément.
 * Croissance des vidéos déjà suivies : uniformément.
 */
function spread(total, days, platform, currentPosts, previousPosts, profile) {
  const weights = datedWeights(days, platform, currentPosts, previousPosts);
  const previous = new Map((previousPosts || []).map((p) => [p.id, p.views]));
  const profileSum = profile.reduce((s, w) => s + w, 0);
  for (const post of currentPosts || []) {
    if (!isNew(previous, post)) {
      const gained = Math.max(0, post.views - previous.get(post.id));
      for (let j = 0; j < days.length; j++) weights[j] += gained / days.length;
    } else if (!publishedDay(platform, post.id)) {
      for (let j = 0; j < days.length; j++) weights[j] += profileSum > 0 ? post.views * (profile[j] / profileSum) : post.views / days.length;
    }
  }
  const sum = weights.reduce((s, w) => s + w, 0);
  const shares = sum > 0 ? weights.map((w) => w / sum) : weights.map(() => 1 / days.length);
  // Arrondi au plus fort reste : la somme retombe exactement sur `total`
  // sans reporter tout l'arrondi sur le dernier jour.
  const exact = shares.map((sh) => total * sh);
  const alloc = exact.map(Math.floor);
  let rest = total - alloc.reduce((s, v) => s + v, 0);
  const order = exact.map((v, j) => [v - Math.floor(v), j]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (const [, j] of order) {
    if (rest <= 0) break;
    alloc[j]++;
    rest--;
  }
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
      const profile = ['ig', 'tt'].reduce((acc, k) => {
        const w = datedWeights(days, k, current?.posts?.[k], previous?.posts?.[k]);
        return acc.map((v, j) => v + w[j]);
      }, new Array(days.length).fill(0));
      const per = Object.fromEntries(['ig', 'tt', 'yt'].map((k) => [k, spread(g[k], days, k, current?.posts?.[k], previous?.posts?.[k], profile)]));
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

/**
 * Lignes account_views : cumul all-time par compte. Une plateforme qui n'est
 * plus suivie (URL vide : compte banni ou retiré) est envoyée à 0 pour ne pas
 * s'afficher comme active ; le total, lui, garde ses vues passées.
 */
export function buildAccountViewsRows(cumulative, updatedAt = new Date().toISOString(), accounts = []) {
  const urlsByName = new Map(accounts.map((a) => [a.name, a.urls || []]));
  return Object.entries(cumulative).map(([account, v]) => {
    const urls = urlsByName.get(account);
    const shown = (k, i) => (urls && !urls[i] ? 0 : v[k] || 0);
    return {
      account_name: account,
      total: v.total || 0,
      ig: shown('ig', 0),
      tt: shown('tt', 1),
      yt: shown('yt', 2),
      updated_at: updatedAt
    };
  });
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
    const totals = buildAccountViewsRows(loadCumulativeViews(), fs.statSync(HISTORY_PATH).mtime.toISOString(), loadAccounts());
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
