import fs from 'fs';
import path from 'path';
import { todayKey } from './history.js';

// Même logique de persistance que history.js/lastMessage.js : sur Railway,
// CUMULATIVE_VIEWS_PATH pointe vers le volume monté sur /data pour survivre
// aux redéploiements.
const CUMULATIVE_PATH = process.env.CUMULATIVE_VIEWS_PATH || path.resolve('./data/cumulative-views.json');

/**
 * @returns {Record<string, {total: number, ig: number, tt: number, yt: number, lastUpdated: string}>}
 * Cumul "all time" par compte, plateforme par plateforme. {} si rien n'a
 * encore été enregistré.
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
 * Met à jour le cumul "all time" : contrairement au total du jour (photo
 * instantanée des derniers posts), le all-time additionne le total de
 * *chaque collecte déjà réalisée*, jour après jour, sans jamais repartir de
 * zéro — les mêmes vidéos sont donc recomptées à chaque cron, volontairement
 * (le all-time reflète l'activité cumulée suivie par le bot, pas le nombre
 * de vidéos distinctes).
 *
 * Idempotent par jour (`lastUpdated` par compte) : relancer `npm run scan`
 * plusieurs fois le même jour, ou un cron qui se déclenche deux fois, ne
 * doit additionner le total du jour qu'une seule fois.
 *
 * @param {Record<string, {total: number, ig: number, tt: number, yt: number, lastUpdated: string}>} cumulative État actuel
 * @param {Array<{account: string, ig: number|null, tt: number|null, yt: number|null, total: number}>} summary Résumé du jour
 * @returns {Record<string, {total: number, ig: number, tt: number, yt: number, lastUpdated: string}>} Le cumul mis à jour (nouvel objet, n'altère pas `cumulative`)
 */
export function updateCumulativeViews(cumulative, summary) {
  const updated = { ...cumulative };
  const today = todayKey();

  for (const item of summary) {
    if (typeof item.total !== 'number') continue;

    const existing = updated[item.account];
    if (existing && existing.lastUpdated === today) continue; // déjà compté aujourd'hui

    // null (compte absent sur cette plateforme, "Ban") ne contribue pour rien.
    const ig = typeof item.ig === 'number' ? item.ig : 0;
    const tt = typeof item.tt === 'number' ? item.tt : 0;
    const yt = typeof item.yt === 'number' ? item.yt : 0;

    updated[item.account] = {
      total: (existing?.total || 0) + item.total,
      ig: (existing?.ig || 0) + ig,
      tt: (existing?.tt || 0) + tt,
      yt: (existing?.yt || 0) + yt,
      lastUpdated: today
    };
  }

  return updated;
}
