import path from 'path';
import { readJson, writeJsonAtomic } from './jsonStore.js';

// Suivi du dernier envoi réussi vers l'app Lovable (voir supabaseViews.js) —
// contrairement aux échecs de scrape, un envoi qui échoue ne bloquait rien
// de visible (les vues restent correctes en local, l'app se contente de ne
// plus se mettre à jour) et ne déclenchait aucune alerte : un problème
// silencieux et prolongé (ex. clé invalidée côté app) pouvait passer
// inaperçu pendant des jours.
export const PUSH_STATUS_PATH = process.env.PUSH_STATUS_PATH || path.resolve('./data/push-status.json');

const ALERT_AFTER_MS = 24 * 60 * 60 * 1000;
// Empêche de renvoyer un MP à chaque collecte tant que la panne dure (~1/soir) :
// une seule alerte tant qu'aucun envoi n'a réussi entre-temps.
const ALERT_COOLDOWN_MS = 20 * 60 * 60 * 1000;

export function getPushStatus() {
  return readJson(PUSH_STATUS_PATH, { lastOkAt: null, lastAlertAt: null }, 'Statut d\'envoi vers l\'app');
}

/** À appeler après chaque tentative d'envoi (réussie ou non). */
export function recordPushResult(ok) {
  const status = getPushStatus();
  if (ok) status.lastOkAt = new Date().toISOString();
  writeJsonAtomic(PUSH_STATUS_PATH, status);
}

export function markPushAlertSent() {
  const status = getPushStatus();
  status.lastAlertAt = new Date().toISOString();
  writeJsonAtomic(PUSH_STATUS_PATH, status);
}

/** L'envoi échoue depuis plus de 24h et aucune alerte n'a été envoyée depuis. */
export function shouldAlertPushFailure(status = getPushStatus()) {
  const now = Date.now();
  const lastOk = status.lastOkAt ? Date.parse(status.lastOkAt) : null;
  const stale = !lastOk || (now - lastOk) > ALERT_AFTER_MS;
  if (!stale) return false;
  const lastAlert = status.lastAlertAt ? Date.parse(status.lastAlertAt) : null;
  return !lastAlert || (now - lastAlert) > ALERT_COOLDOWN_MS;
}
