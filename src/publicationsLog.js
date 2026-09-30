import path from 'path';
import { readJson, writeJsonAtomic } from './jsonStore.js';
import { todayKey } from './history.js';
import { publishedDay } from './platformIds.js';

// Journal des publications repérées (`seenPosts`, voir instagram.js et
// config.js#publicationsScanLimit) — décorrélé du suivi des vues
// (`posts`, IG_POSTS_LIMIT) qui alimente croissance/cumul/wins : celui-ci ne
// sert qu'à compter le rythme de publication, avec un vrai jour de
// publication pour TikTok/Instagram (décodé de l'identifiant) et, à défaut
// (YouTube), le jour où le bot l'a vue pour la première fois. Une fenêtre de
// lecture plus large (12 par défaut contre 2) réduit fortement le risque
// qu'une publication soit remplacée avant d'avoir été vue ne serait-ce
// qu'une fois — sans changer le suivi des vues ni son historique.
export const PUBLICATIONS_LOG_PATH = process.env.PUBLICATIONS_LOG_PATH || path.resolve('./data/publications-log.json');

// Garde-fou de taille : à ~1400 publications distinctes vues en 2 mois sur
// 20 comptes (voir l'audit du 29/09/2026), largement suffisant pour ne
// jamais purger de données récentes en usage normal.
const MAX_ENTRIES = 50_000;

export function loadPublicationsLog() {
  const parsed = readJson(PUBLICATIONS_LOG_PATH, [], 'Journal des publications');
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Enregistre les publications jamais vues jusqu'ici (clé `platform+id`,
 * jamais dupliquée). Ne modifie jamais une entrée existante : la première
 * apparition d'une publication fait foi.
 * @param {Array} summary Résultat de buildViewsSummary (avec `seenPosts`)
 * @param {string} [date] Jour de cette collecte (YYYY-MM-DD)
 * @returns {number} Nombre de publications nouvellement enregistrées
 */
export function recordSeenPublications(summary, date = todayKey()) {
  const log = loadPublicationsLog();
  const known = new Set(log.map(p => `${p.platform}|${p.id}`));
  let added = 0;

  for (const item of summary) {
    for (const platform of ['ig', 'tt', 'yt']) {
      for (const post of item.seenPosts?.[platform] || []) {
        const key = `${platform}|${post.id}`;
        if (known.has(key)) continue;
        known.add(key);
        log.push({ account: item.account, platform, id: String(post.id), firstSeenDay: date });
        added++;
      }
    }
  }

  if (added > 0) writeJsonAtomic(PUBLICATIONS_LOG_PATH, log.slice(-MAX_ENTRIES));
  return added;
}

/**
 * Nombre de publications par jour, à partir du journal. TikTok/Instagram :
 * jour réel de publication (décodé de l'identifiant) — fiable comme
 * *minimum* (une publication remplacée avant d'être repérée ne serait-ce
 * qu'une fois n'apparaît jamais nulle part). YouTube : pas de date réelle
 * disponible, seulement le jour de première apparition dans une collecte —
 * une approximation, surtout après un arrêt prolongé du bot (voir
 * docs/audit-viewtracker.md).
 * @param {{from?: string, to?: string, account?: string}} [filter]
 * @returns {{tt_ig: Record<string, number>, yt: Record<string, number>}}
 */
export function getPublicationsPerDay({ from, to, account } = {}) {
  const log = loadPublicationsLog().filter(
    (p) => (!account || p.account === account) && (!from || p.firstSeenDay >= from) && (!to || p.firstSeenDay <= to)
  );
  const ttIg = {};
  const yt = {};
  for (const p of log) {
    if (p.platform === 'yt') {
      yt[p.firstSeenDay] = (yt[p.firstSeenDay] || 0) + 1;
      continue;
    }
    const day = publishedDay(p.platform, p.id) || p.firstSeenDay;
    ttIg[day] = (ttIg[day] || 0) + 1;
  }
  return { tt_ig: ttIg, yt };
}

/**
 * Renomme un compte dans le journal — même migration que
 * history.js#renameAccountInHistory, pour ne pas perdre l'historique de
 * publications d'un compte renommé.
 */
export function renameAccountInPublicationsLog(oldName, newName) {
  const log = loadPublicationsLog();
  let changed = false;
  for (const entry of log) {
    if (entry.account === oldName) {
      entry.account = newName;
      changed = true;
    }
  }
  if (changed) writeJsonAtomic(PUBLICATIONS_LOG_PATH, log);
}
