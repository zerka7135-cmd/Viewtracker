import fs from 'fs';
import path from 'path';
import { todayKey } from './history.js';

// Même logique de persistance que history.js/lastMessage.js : sur Railway,
// CUMULATIVE_VIEWS_PATH pointe vers le volume monté sur /data pour survivre
// aux redéploiements.
const CUMULATIVE_PATH = process.env.CUMULATIVE_VIEWS_PATH || path.resolve('./data/cumulative-views.json');

/**
 * @returns {Record<string, {total: number, lastUpdated: string}>} Total de
 * vues cumulées depuis le début du suivi, par compte, avec la date de
 * dernière mise à jour (voir updateCumulativeViews). {} si rien n'a encore
 * été enregistré.
 */
export function loadCumulativeViews() {
  try {
    if (!fs.existsSync(CUMULATIVE_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(CUMULATIVE_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Erreur de lecture du cumul de vues, on repart de zéro :', e.message);
    return {};
  }
}

export function saveCumulativeViews(cumulative) {
  fs.mkdirSync(path.dirname(CUMULATIVE_PATH), { recursive: true });
  fs.writeFileSync(CUMULATIVE_PATH, JSON.stringify(cumulative, null, 2));
}

/**
 * Met à jour le cumul "all time" à partir de la progression du jour.
 *
 * Le "total" du jour n'est qu'une photo instantanée des derniers posts (pas
 * un compteur cumulatif en soi) : ce qu'on additionne ici, c'est la
 * *progression* observée depuis la veille (`growth24h`, delta jour à jour),
 * pas le total brut — sinon les mêmes vidéos seraient recomptées en entier
 * chaque jour. Un delta négatif (vidéo qui sort du top N, compte
 * temporairement banni...) n'est jamais soustrait du cumul : le all-time ne
 * peut que monter.
 *
 * Idempotent par jour (`lastUpdated`) : relancer `npm run scan` plusieurs
 * fois le même jour, ou un cron qui se déclenche deux fois, ne doit ajouter
 * la progression qu'une seule fois — sinon le cumul gonflerait à chaque
 * relance manuelle au lieu de refléter les vraies vues gagnées.
 *
 * Pour un compte jamais vu jusqu'ici (absent de `cumulative`), le total du
 * jour sert de point de départ — la meilleure estimation disponible des vues
 * déjà faites avant le début du suivi.
 *
 * @param {Record<string, {total: number, lastUpdated: string}>} cumulative État actuel (voir loadCumulativeViews)
 * @param {Map<string, {delta: number}>} growth24h Voir history.js#computeGrowth, appelé avec lookbackDays=1
 * @param {Array<{account: string, total: number}>} summary Résumé du jour
 * @returns {Record<string, {total: number, lastUpdated: string}>} Le cumul mis à jour (nouvel objet, n'altère pas `cumulative`)
 */
export function updateCumulativeViews(cumulative, growth24h, summary) {
  const updated = { ...cumulative };
  const today = todayKey();

  for (const item of summary) {
    if (typeof item.total !== 'number') continue;

    const existing = updated[item.account];

    if (!existing) {
      updated[item.account] = { total: item.total, lastUpdated: today };
      continue;
    }

    if (existing.lastUpdated === today) continue; // déjà mis à jour aujourd'hui, on n'ajoute pas deux fois

    const g = growth24h.get(item.account);
    const delta = g ? Math.max(0, g.delta) : 0;
    updated[item.account] = { total: existing.total + delta, lastUpdated: today };
  }

  return updated;
}

/**
 * @param {Record<string, {total: number, lastUpdated: string}>} cumulative
 * @returns {Record<string, number>} Juste les totaux, pour l'affichage (voir embed.js)
 */
export function cumulativeTotals(cumulative) {
  return Object.fromEntries(Object.entries(cumulative).map(([account, v]) => [account, v.total]));
}
