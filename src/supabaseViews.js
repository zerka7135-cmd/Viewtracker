import fs from 'fs';
import { loadHistory, computeGrowth24h, HISTORY_PATH } from './history.js';
import { loadCumulativeViews } from './cumulativeViews.js';
import { loadAccounts } from './accountsStore.js';
import { recordPushResult } from './pushStatus.js';
import { publishedMs, publishedDay } from './platformIds.js';

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

const SEND_ATTEMPTS = 3;

// Un envoi (une tentative) : { ok: true } ou { ok: false, error, retriable }.
// Une erreur 4xx (hors 429, limite de débit) ne se résoudra pas en
// réessayant — secret invalide, payload rejeté — donc `retriable: false`
// fait abandonner tout de suite plutôt que de perdre du temps sur
// plusieurs tentatives vaines.
async function sendOnce(table, batch, extra) {
  try {
    const res = await fetch(functionUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.VIEWS_INGEST_SECRET },
      body: JSON.stringify({ table, rows: batch, ...extra }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (res.ok) {
      // Des lignes silencieusement ignorées par l'app (payload jugé invalide
      // de son côté) ne doivent pas passer pour un succès complet sans
      // laisser de trace.
      const body = await res.json().catch(() => null);
      if (body?.skipped) console.error(`${table} : ${body.skipped} ligne(s) ignorée(s) par l'app sur ${body.count ?? '?'} reçue(s)`);
      return { ok: true };
    }

    const detail = (await res.text()).slice(0, 200);
    const retriable = res.status === 429 || res.status >= 500;
    return { ok: false, error: new Error(`${table} : HTTP ${res.status} ${detail}`), retriable };
  } catch (error) {
    return { ok: false, error, retriable: true };
  }
}

async function sendWithRetry(table, batch, extra) {
  let result;
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
    result = await sendOnce(table, batch, extra);
    if (result.ok || !result.retriable) break;
    if (attempt < SEND_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
  }
  if (!result.ok) throw result.error;
}

async function send(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await sendWithRetry(table, rows.slice(i, i + BATCH_SIZE));
  }
}

// `extra` (ex. prune_day) doit voir TOUTES les lignes concernées en un seul
// envoi, jamais réparties sur plusieurs lots — sinon l'app nettoierait à
// tort des lignes valides tombées dans un autre lot qu'elle n'a pas sous
// les yeux. INGEST_HARD_LIMIT est la limite dure côté app (1000 lignes par
// requête) : si jamais dépassée, on renonce au nettoyage plutôt que de
// risquer d'en perdre.
const INGEST_HARD_LIMIT = 1000;

async function sendWithExtra(table, rows, extra) {
  if (rows.length > INGEST_HARD_LIMIT) {
    console.error(`${table} : ${rows.length} lignes dépassent la limite d'un seul envoi (${INGEST_HARD_LIMIT}), nettoyage ignoré ce passage`);
    return send(table, rows);
  }
  return sendWithRetry(table, rows, extra);
}

// Quand deux collectes sont espacées de plus d'un jour (bot arrêté,
// migration, collecte manquée...), le gain rattrapé est réparti sur les jours
// du trou au lieu de tomber en entier sur le jour de la collecte. Ce sont des
// estimations (estimated: true) ; le total est inchangé.
const GAP_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (key, n) => dayKey(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS);

// Décodage de la date de publication (TikTok/Instagram) : voir platformIds.js.
// publishedDay est réexporté ici pour ne pas casser les imports existants.
export { publishedDay };

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

/** Pseudo TikTok d'un compte (depuis son URL de profil), null si non suivi. */
function tiktokUser(urls) {
  const match = String(urls?.[1] || '').match(/tiktok\.com\/@?([^/?#]+)/);
  return match ? match[1] : null;
}

/** Lien direct vers une publication ; null si impossible (TikTok sans pseudo connu). */
export function postUrl(platform, id, urls) {
  if (platform === 'ig') return `https://www.instagram.com/reel/${id}/`;
  if (platform === 'yt') return `https://www.youtube.com/shorts/${id}`;
  const user = tiktokUser(urls);
  return user ? `https://www.tiktok.com/@${user}/video/${id}` : null;
}

const HOUR_MS = 60 * 60 * 1000;
const NAMES = { ig: 'Instagram', tt: 'TikTok', yt: 'YouTube' };

// `seenPosts` (fenêtre large, voir config.js#publicationsScanLimit) est un
// sur-ensemble de `posts` (fenêtre suivie pour la croissance/le cumul,
// IG_POSTS_LIMIT) : on s'en sert ici pour élargir la détection des wins à
// plus de vidéos, avec repli sur `posts` pour les collectes enregistrées
// avant l'ajout de `seenPosts`.
const scannedPosts = (entryAccount, platform) => entryAccount?.seenPosts?.[platform] || entryAccount?.posts?.[platform] || [];

/** La plateforme a-t-elle été relevée avec succès pour ce compte à cette collecte ? */
function scraped(entryAccount, platform) {
  return Boolean(entryAccount)
    && scannedPosts(entryAccount, platform).length > 0
    && !(entryAccount.errors || []).some((e) => e.platform === NAMES[platform]);
}

/**
 * Âge maximum prouvé (heures) d'une publication au moment d'un relevé, null
 * si rien ne le prouve :
 *  - TikTok / Instagram : heure du relevé − date de publication (lue dans l'identifiant) ;
 *  - YouTube : heure du relevé − heure de la collecte réussie qui précède sa
 *    première apparition (elle n'était pas encore parmi les dernières vidéos).
 * Les collectes enregistrées avant l'ajout de collectedAt ne prouvent rien.
 */
function maxAgeHours(history, index, account, platform, postId) {
  const observed = Date.parse(history[index].collectedAt || '');
  if (!Number.isFinite(observed)) return null;

  let since = publishedMs(platform, postId);
  if (!since) {
    const first = history.findIndex((e) => scannedPosts(e.accounts.find((a) => a.account === account), platform).some((p) => String(p.id) === String(postId)));
    const before = first > 0 ? history[first - 1] : null;
    const beforeAt = Date.parse(before?.collectedAt || '');
    if (!before || !Number.isFinite(beforeAt) || !scraped(before.accounts.find((a) => a.account === account), platform)) return null;
    since = beforeAt;
  }
  return Math.max(0, Math.ceil(((observed - since) / HOUR_MS) * 100) / 100);
}

/**
 * Lignes post_views : vues de chaque publication repérée à chaque collecte
 * (jusqu'à PUBLICATIONS_SCAN_LIMIT par plateforme — plus large que les 2
 * suivies pour la croissance/le cumul, IG_POSTS_LIMIT — pour donner à la
 * détection des wins plus de chances de voir une vidéo avant qu'elle ne
 * soit remplacée), avec l'heure du relevé et l'âge maximum prouvé de la
 * publication (règle des wins : 75k en 24 h maximum).
 */
export function buildPostViewsRows(history, accounts = []) {
  const urlsByName = new Map(accounts.map((a) => [a.name, a.urls || []]));
  const rows = [];
  history.forEach((entry, index) => {
    for (const a of entry.accounts) {
      for (const platform of ['ig', 'tt', 'yt']) {
        for (const post of scannedPosts(a, platform)) {
          const url = postUrl(platform, post.id, urlsByName.get(a.account));
          if (!url) continue;
          const ms = publishedMs(platform, post.id);
          rows.push({
            account_name: a.account,
            platform,
            post_id: String(post.id),
            url,
            day: entry.date,
            views: post.views,
            published_at: ms ? new Date(ms).toISOString() : null,
            observed_at: entry.collectedAt || null,
            max_age_hours: maxAgeHours(history, index, a.account, platform, post.id)
          });
        }
      }
    }
  });
  return rows;
}

/**
 * Lignes account_views : cumul all-time par compte. Une plateforme qui n'est
 * plus suivie (URL vide : compte banni ou retiré) est envoyée à 0 pour ne pas
 * s'afficher comme active, et ses vues sont retirées de `total` aussi — sinon
 * `total` resterait plus grand que `ig + tt + yt`, un écart qui ne se corrige
 * d'aucun côté puisqu'il est renvoyé identique à chaque collecte. Le fichier
 * interne du bot (cumulative-views.json) garde l'historique complet, intact :
 * seule la version envoyée à l'app est réduite.
 */
export function buildAccountViewsRows(cumulative, updatedAt = new Date().toISOString(), accounts = []) {
  const urlsByName = new Map(accounts.map((a) => [a.name, a.urls || []]));
  return Object.entries(cumulative).map(([account, v]) => {
    const urls = urlsByName.get(account);
    const masked = (k, i) => Boolean(urls && !urls[i]);
    const shown = (k, i) => (masked(k, i) ? 0 : v[k] || 0);
    const hiddenTotal = ['ig', 'tt', 'yt']
      .map((k, i) => (masked(k, i) ? v[k] || 0 : 0))
      .reduce((sum, n) => sum + n, 0);
    return {
      account_name: account,
      total: Math.max(0, (v.total || 0) - hiddenTotal),
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

    // Publications à part : un échec ici ne doit pas masquer l'envoi des vues.
    let postsNote;
    try {
      const history = loadHistory();
      const posts = buildPostViewsRows(history, loadAccounts());
      // Un même jour calendaire peut être collecté deux fois (collecte
      // manuelle suivie du cron, ou l'inverse) : seule la dernière collecte
      // du jour est gardée dans l'historique, mais sans nettoyage, les
      // publications repérées par la précédente (remplacée depuis) restent
      // en résidu chez l'app, puisque l'envoi n'ajoute/remplace mais ne
      // retire jamais. Seul le dernier jour connu peut avoir ce résidu : un
      // jour passé n'est plus jamais recollecté, donc jamais à nettoyer —
      // ses lignes repartent par le circuit normal, sans `prune_day`.
      const latestDay = history.at(-1)?.date;
      const latestDayPosts = posts.filter((r) => r.day === latestDay);
      const pastPosts = posts.filter((r) => r.day !== latestDay);
      await send('post_views', pastPosts);
      if (latestDay) await sendWithExtra('post_views', latestDayPosts, { prune_day: latestDay });
      postsNote = `${posts.length} publication(s)`;
    } catch (error) {
      postsNote = `publications en échec (${error.message})`;
      console.error('Envoi des publications vers l\'app Lovable en échec :', error.message);
    }

    const message = `${daily.length} ligne(s) de vues, ${totals.length} cumul(s) et ${postsNote} envoyés à l'app Lovable`;
    console.log(message);
    recordPushResult(true);
    return { ok: true, message };
  } catch (error) {
    const message = error.name === 'TimeoutError' ? 'L\'app Lovable ne répond pas (délai dépassé)' : error.message;
    console.error('Envoi des vues vers l\'app Lovable en échec :', message);
    recordPushResult(false);
    return { ok: false, message };
  }
}
