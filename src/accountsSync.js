import { loadAccounts, addAccount, updateAccount, deleteAccount, setAccountClipperId } from './accountsStore.js';

// Comptes suivis gérés depuis l'app Lovable (Clipper HQ) : le bot relit la
// liste des clippers actifs et de leurs pseudos (GET ACCOUNTS_SYNC_URL, en-tête
// x-ingest-secret = VIEWS_INGEST_SECRET) au démarrage, toutes les
// ACCOUNTS_SYNC_MINUTES et juste avant chaque collecte. L'app fait foi :
//
//   clipper nouveau               -> compte ajouté
//   clipper renommé (même id)     -> compte renommé, historique et cumul migrés
//   pseudo modifié                -> URL mise à jour
//   clipper désactivé / supprimé  -> plus scrapé ; ses données sont conservées
//
// Le lien se fait par l'id du clipper (clipperId, enregistré sur le compte),
// et la toute première fois par le nom (discord_name = nom du compte, sans
// tenir compte de la casse). Garde-fous : une liste vide, ou qui retirerait
// d'un coup plus d'un tiers des comptes, est refusée (bug côté app plutôt
// que vraie décision).

const REQUEST_TIMEOUT_MS = 20_000;
const PLATFORMS = ['ig', 'tt', 'yt'];
const MAX_REMOVAL_RATIO = 1 / 3;

let lastEtag = null;
let running = false;

export function isAccountsSyncConfigured() {
  return Boolean(process.env.ACCOUNTS_SYNC_URL && process.env.VIEWS_INGEST_SECRET);
}

const nameKey = (name) => String(name ?? '').trim().toLowerCase();

/** Pseudo nu depuis une URL de profil ou un pseudo saisi (@, domaine, slash retirés). */
export function handleOf(value) {
  let s = String(value ?? '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^(www\.|m\.|vm\.)/, '');
  s = s.replace(/^(instagram\.com|tiktok\.com|youtube\.com|youtu\.be)\/((c|user|channel)\/)?/, '');
  s = s.replace(/[/?#].*$/, '').replace(/^@+/, '');
  return s.trim();
}

const URL_FOR = {
  ig: (h) => `https://www.instagram.com/${h}/`,
  tt: (h) => `https://www.tiktok.com/@${h}`,
  yt: (h) => `https://www.youtube.com/@${h}`
};

/** [igUrl, ttUrl, ytUrl] du clipper ; garde l'URL actuelle si elle désigne le même pseudo. */
function urlsFor(remoteAccounts, currentUrls = ['', '', '']) {
  return PLATFORMS.map((platform, i) => {
    const handle = handleOf(remoteAccounts.find((a) => a.platform === platform)?.handle);
    if (!handle) return '';
    return handleOf(currentUrls[i]) === handle ? currentUrls[i] : URL_FOR[platform](handle);
  });
}

function parseClippers(body) {
  if (!body || !Array.isArray(body.clippers)) throw new Error('réponse inattendue (clippers manquant)');
  const seen = new Set();
  const clippers = [];
  for (const c of body.clippers) {
    const name = String(c?.name ?? '').trim();
    if (!c?.clipper_id || !name) throw new Error('clipper sans id ou sans nom');
    if (seen.has(nameKey(name))) throw new Error(`nom de clipper en double : ${name}`);
    seen.add(nameKey(name));
    const accounts = (Array.isArray(c.accounts) ? c.accounts : []).filter((a) => PLATFORMS.includes(a?.platform) && handleOf(a.handle));
    // Un clipper sans aucun réseau n'a rien à scraper : traité comme absent.
    if (accounts.length) clippers.push({ id: String(c.clipper_id), name, accounts });
  }
  return clippers;
}

/**
 * Changements à appliquer pour aligner les comptes suivis sur la liste de l'app.
 * @returns {{add: object[], rename: object[], update: object[], link: object[], remove: string[], skipped: string[]}}
 */
export function planAccountsSync(current, clippers) {
  const plan = { add: [], rename: [], update: [], link: [], remove: [], skipped: [] };
  const byId = new Map(current.filter((a) => a.clipperId).map((a) => [a.clipperId, a]));
  const byName = new Map(current.map((a) => [nameKey(a.name), a]));
  const matched = new Set();

  for (const clipper of clippers) {
    let local = byId.get(clipper.id);
    if (!local) {
      const sameName = byName.get(nameKey(clipper.name));
      if (sameName && (!sameName.clipperId || sameName.clipperId === clipper.id)) local = sameName;
    }

    if (!local) {
      if (byName.has(nameKey(clipper.name))) {
        plan.skipped.push(`${clipper.name} : nom déjà pris par un autre compte`);
        continue;
      }
      plan.add.push({ name: clipper.name, urls: urlsFor(clipper.accounts), clipperId: clipper.id });
      continue;
    }

    matched.add(local.name);
    const urls = urlsFor(clipper.accounts, local.urls);
    if (local.name !== clipper.name) {
      const taken = byName.get(nameKey(clipper.name));
      if (taken && taken !== local) plan.skipped.push(`${local.name} -> ${clipper.name} : nom déjà pris par un autre compte`);
      else plan.rename.push({ from: local.name, to: clipper.name, urls });
    } else if (urls.some((u, i) => u !== (local.urls[i] || ''))) {
      plan.update.push({ name: local.name, urls });
    }
    if (local.clipperId !== clipper.id) plan.link.push({ name: clipper.name, clipperId: clipper.id });
  }

  for (const a of current) if (!matched.has(a.name)) plan.remove.push(a.name);
  return plan;
}

function applyPlan(plan) {
  const done = [];
  const failed = [];
  const run = (label, fn) => {
    try { fn(); done.push(label); } catch (error) { failed.push(`${label} (${error.message})`); }
  };
  for (const r of plan.rename) run(`renommé ${r.from} -> ${r.to}`, () => updateAccount(r.from, r.to, r.urls));
  for (const u of plan.update) run(`pseudos mis à jour : ${u.name}`, () => updateAccount(u.name, u.name, u.urls));
  for (const name of plan.remove) run(`retiré : ${name}`, () => deleteAccount(name));
  for (const a of plan.add) run(`ajouté : ${a.name}`, () => { addAccount(a.name, a.urls); setAccountClipperId(a.name, a.clipperId); });
  for (const l of plan.link) {
    if (loadAccounts().some((a) => a.name === l.name)) run(`relié : ${l.name}`, () => setAccountClipperId(l.name, l.clipperId));
  }
  return { done, failed };
}

/**
 * Relit la liste de l'app et met à jour les comptes suivis. Ne lève jamais.
 * @returns {Promise<{ok: boolean, message: string, changes?: string[]}>}
 */
export async function syncAccountsFromApp({ dryRun = false } = {}) {
  if (!process.env.VIEWS_INGEST_SECRET || !(process.env.ACCOUNTS_SYNC_URL || dryRun)) return { ok: false, message: 'Synchronisation des comptes non configurée' };
  if (running) return { ok: false, message: 'Synchronisation des comptes déjà en cours' };
  running = true;
  try {
    const url = new URL(process.env.ACCOUNTS_SYNC_URL || defaultSyncUrl());
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !local) throw new Error('ACCOUNTS_SYNC_URL doit être en https');

    const headers = { 'x-ingest-secret': process.env.VIEWS_INGEST_SECRET };
    if (lastEtag && !dryRun) headers['If-None-Match'] = lastEtag;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (res.status === 304) return { ok: true, message: 'Comptes inchangés' };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const clippers = parseClippers(await res.json());
    const current = loadAccounts();
    const plan = planAccountsSync(current, clippers);
    if (dryRun) return { ok: true, message: 'Simulation : aucun changement appliqué', plan, clippers: clippers.length };

    if (clippers.length === 0) throw new Error('liste vide reçue : aucun compte modifié');
    if (current.length > 0 && plan.remove.length > current.length * MAX_REMOVAL_RATIO) {
      throw new Error(`${plan.remove.length} compte(s) sur ${current.length} seraient retirés d'un coup : refusé par sécurité (${plan.remove.join(', ')})`);
    }

    const { done, failed } = applyPlan(plan);
    const changes = [...done, ...plan.skipped.map((s) => `ignoré : ${s}`), ...failed.map((f) => `échec : ${f}`)];
    // L'ETag n'est retenu que si tout est passé : sinon la liste est reprise au prochain passage.
    if (failed.length === 0) lastEtag = res.headers.get('etag');
    const message = changes.length ? `Comptes synchronisés : ${changes.join(' ; ')}` : 'Comptes déjà à jour';
    if (changes.length) console.log(message);
    return { ok: failed.length === 0, message, changes };
  } catch (error) {
    const message = `Synchronisation des comptes en échec : ${error.name === 'TimeoutError' ? 'l\'app ne répond pas' : error.message}`;
    console.error(message);
    return { ok: false, message };
  } finally {
    running = false;
  }
}

/** Même app que la réception des vues (VIEWS_INGEST_URL), route clipper-accounts. */
function defaultSyncUrl() {
  if (!process.env.VIEWS_INGEST_URL) throw new Error('ACCOUNTS_SYNC_URL non renseignée');
  return new URL('/api/public/clipper-accounts', process.env.VIEWS_INGEST_URL).toString();
}

/** Remet à zéro l'ETag mémorisé (tests). */
export function resetAccountsSyncCache() {
  lastEtag = null;
}
