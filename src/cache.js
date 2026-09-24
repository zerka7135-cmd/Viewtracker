import fs from 'fs';
import path from 'path';

const LOCK_PATH = process.env.LOCK_PATH || path.resolve('data/.scrape.lock');
const LOCK_MAX_AGE_MS = 30 * 60 * 1000; // 30 min : au-delà, on considère le lock comme périmé (process planté)

/**
 * Empêche deux collectes de tourner en même temps (cron + `npm run scan`
 * manuel) qui se marcheraient dessus. Un lock plus vieux que LOCK_MAX_AGE_MS est considéré
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
