import path from 'path';
import { todayKey } from './history.js';
import { readJson, writeJsonAtomic } from './jsonStore.js';

// Même logique de persistance que history.js/lastMessage.js : sur Railway,
// CUMULATIVE_VIEWS_PATH pointe vers le volume monté sur /data pour survivre
// aux redéploiements.
export const CUMULATIVE_PATH = process.env.CUMULATIVE_VIEWS_PATH || path.resolve('./data/cumulative-views.json');

/**
 * @returns {Record<string, {total: number, ig: number, tt: number, yt: number, lastUpdated: string}>}
 * Cumul "all time" par compte, plateforme par plateforme. {} si rien n'a
 * encore été enregistré.
 */
export function loadCumulativeViews() {
  const parsed = readJson(CUMULATIVE_PATH, {}, 'Cumul de vues');
  return parsed && typeof parsed === 'object' ? parsed : {};
}

export function saveCumulativeViews(cumulative) {
  writeJsonAtomic(CUMULATIVE_PATH, cumulative);
}

/**
 * Met à jour le cumul "all time" à partir des vues gagnées dans les
 * dernières 24h (`growth24h`, voir history.js#computeGrowth24h) : même
 * mécanisme que le leaderboard "Last 24h" — ce qui est affiché comme gagné
 * aujourd'hui est ce qui s'ajoute au cumul, jamais le total brut (sinon les
 * mêmes vidéos seraient recomptées en entier chaque jour). Un delta négatif
 * n'est jamais soustrait : le all-time ne peut que monter.
 *
 * Idempotent par jour (`lastUpdated` par compte) : relancer `npm run scan`
 * plusieurs fois le même jour, ou un cron qui se déclenche deux fois, ne
 * doit ajouter la progression qu'une seule fois.
 *
 * Pour un compte jamais vu jusqu'ici (absent de `cumulative`), le total du
 * jour sert de point de départ — la meilleure estimation disponible des vues
 * déjà faites avant le début du suivi.
 *
 * @param {Record<string, {total: number, ig: number, tt: number, yt: number, lastUpdated: string}>} cumulative État actuel
 * @param {Map<string, {total: number, ig: number, tt: number, yt: number}>} growth24h Voir history.js#computeGrowth24h
 * @param {Array<{account: string, ig: number|null, tt: number|null, yt: number|null, total: number}>} summary Résumé du jour
 * @returns {Record<string, {total: number, ig: number, tt: number, yt: number, lastUpdated: string}>} Le cumul mis à jour (nouvel objet, n'altère pas `cumulative`)
 */
export function updateCumulativeViews(cumulative, growth24h, summary) {
  const updated = { ...cumulative };
  const today = todayKey();

  for (const item of summary) {
    if (typeof item.total !== 'number') continue;

    const existing = updated[item.account];
    if (existing && existing.lastUpdated === today) continue; // déjà compté aujourd'hui

    if (!existing) {
      // Premier jour de suivi pour ce compte : le total du jour sert de
      // point de départ (null/"Ban" ne contribue pour rien).
      updated[item.account] = {
        total: item.total,
        ig: typeof item.ig === 'number' ? item.ig : 0,
        tt: typeof item.tt === 'number' ? item.tt : 0,
        yt: typeof item.yt === 'number' ? item.yt : 0,
        lastUpdated: today
      };
      continue;
    }

    const g = growth24h.get(item.account);
    updated[item.account] = {
      total: existing.total + (g?.total || 0),
      ig: existing.ig + (g?.ig || 0),
      tt: existing.tt + (g?.tt || 0),
      yt: existing.yt + (g?.yt || 0),
      lastUpdated: today
    };
  }

  return updated;
}

/**
 * Renomme un compte dans le cumul all-time (voir
 * history.js#renameAccountInHistory) — sans ça, le cumul repartait du total
 * du jour sous le nouveau nom, et l'ancien restait orphelin dans le fichier.
 */
export function renameAccountInCumulative(oldName, newName) {
  const cumulative = loadCumulativeViews();
  if (!(oldName in cumulative)) return;
  cumulative[newName] = cumulative[oldName];
  delete cumulative[oldName];
  saveCumulativeViews(cumulative);
}
