import fs from 'fs';
import path from 'path';

const CACHE_PATH = path.resolve('data/last-summary.json');
const LOCK_PATH = path.resolve('data/.scrape.lock');
const LOCK_MAX_AGE_MS = 30 * 60 * 1000; // 30 min : au-delà, on considère le lock comme périmé (process planté)

/**
 * Sauvegarde le dernier résumé calculé, avec l'horodatage de la collecte.
 * Permet à /resume de répondre instantanément avec les dernières données
 * connues, au lieu de relancer un scraping complet (long avec beaucoup de
 * comptes, et sujet au timeout de 15 min des interactions Discord).
 */
export function saveSummary(summary) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  const payload = {
    summary,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2));
}

/**
 * Relit le dernier résumé sauvegardé.
 * @returns {{ summary: Array, updatedAt: string } | null} null si aucune collecte n'a encore eu lieu.
 */
export function loadSummary() {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (e) {
    console.error('Cache de résumé illisible :', e.message);
    return null;
  }
}

/**
 * Empêche deux collectes de tourner en même temps (cron + `npm run scan`
 * manuel), qui écraseraient sinon data/last-summary.json de façon
 * imprévisible. Un lock plus vieux que LOCK_MAX_AGE_MS est considéré
 * comme abandonné (process précédent planté) et ignoré.
 * @returns {boolean} true si le lock a été acquis, false si une collecte est déjà en cours.
 */
export function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });

  if (fs.existsSync(LOCK_PATH)) {
    const age = Date.now() - Number(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (age < LOCK_MAX_AGE_MS) return false;
  }

  fs.writeFileSync(LOCK_PATH, Date.now().toString());
  return true;
}

export function releaseLock() {
  fs.rmSync(LOCK_PATH, { force: true });
}
