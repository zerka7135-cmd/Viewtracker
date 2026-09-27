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
 * Une seule contribution par jour et par compte (`lastUpdated` + `dayGain`) :
 * si une deuxième collecte porte la même date (`npm run scan` relancé, cron
 * rejoué), elle *remplace* la contribution de la première au lieu de
 * s'ajouter ou d'être ignorée. L'historique remplace lui aussi l'entrée du
 * jour, et le gain de la deuxième collecte est calculé depuis la même
 * référence (la veille) : il couvre déjà la période de la première.
 *
 * Pour un compte jamais vu jusqu'ici (absent de `cumulative`), le total du
 * jour sert de point de départ — la meilleure estimation disponible des vues
 * déjà faites avant le début du suivi.
 *
 * @param {Record<string, object>} cumulative État actuel
 * @param {Map<string, {total: number, ig: number, tt: number, yt: number}>} growth24h Voir history.js#computeGrowth24h
 * @param {Array<{account: string, ig: number|null, tt: number|null, yt: number|null, total: number}>} summary Résumé du jour
 * @param {string} [date] Date de la collecte (YYYY-MM-DD), par défaut aujourd'hui
 * @returns {Record<string, object>} Le cumul mis à jour (nouvel objet, n'altère pas `cumulative`)
 */
export function updateCumulativeViews(cumulative, growth24h, summary, date = todayKey()) {
  const updated = { ...cumulative };
  const KEYS = ['total', 'ig', 'tt', 'yt'];
  const num = (v) => (typeof v === 'number' ? v : 0);
  const pick = (source) => Object.fromEntries(KEYS.map((k) => [k, num(source?.[k])]));

  for (const item of summary) {
    if (typeof item.total !== 'number') continue;

    const existing = updated[item.account];
    const sameDay = existing?.lastUpdated === date;
    // Ancien format sans dayGain : la première contribution du jour ne peut
    // pas être retirée, on garde l'ancien comportement (ignorer).
    if (sameDay && !existing.dayGain) continue;

    // Premier jour de suivi (éventuellement rejoué) : le relevé du jour sert de point de départ.
    const isStart = !existing || (sameDay && existing.dayGainIsStart);
    const base = !existing ? pick(null)
      : sameDay ? Object.fromEntries(KEYS.map((k) => [k, existing[k] - num(existing.dayGain[k])]))
      : pick(existing);
    const dayGain = pick(isStart ? item : growth24h.get(item.account));

    updated[item.account] = {
      ...Object.fromEntries(KEYS.map((k) => [k, base[k] + dayGain[k]])),
      lastUpdated: date,
      dayGain,
      ...(isStart ? { dayGainIsStart: true } : {})
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
