import fs from 'fs';
import path from 'path';
import { HISTORY_PATH } from './history.js';

// État de la dernière collecte. `scanning` reste en mémoire seule (ne doit
// jamais survivre à un redémarrage — un process qui redémarre en pleine
// collecte n'est plus "en train de scanner"), mais lastScanAt/lastScanError
// sont persistés : sans ça, un redémarrage du serveur (redéploiement, crash)
// faisait perdre la date de la dernière collecte réelle, affichée à tort
// comme "Aucune collecte enregistrée" côté dashboard alors que l'historique
// contient des mois de données. Lu par GET /api/scan/status (voir
// server.js), mis à jour par scrapeAndBroadcast (voir index.js) — permet au
// dashboard de refléter les collectes du cron sans déclencher de scan
// lui-même (voir README).
export const SCAN_STATUS_PATH = process.env.SCAN_STATUS_PATH || path.resolve('./data/scan-status.json');

let scanning = false;

function readPersisted() {
  try {
    if (!fs.existsSync(SCAN_STATUS_PATH)) return { lastScanAt: null, lastScanError: null };
    return JSON.parse(fs.readFileSync(SCAN_STATUS_PATH, 'utf8'));
  } catch (e) {
    console.error('Erreur de lecture du statut de scan :', e.message);
    return { lastScanAt: null, lastScanError: null };
  }
}

/**
 * @returns {{scanning: boolean, lastScanAt: string|null, lastScanError: string|null}}
 * `lastScanAt` : horodatage précis (ISO). Pour les collectes antérieures à
 * l'ajout de cette persistance (pas d'entrée dans SCAN_STATUS_PATH), on se
 * rabat sur la date de dernière modification de history.json — c'est
 * exactement l'instant où appendToday() a écrit les données de la dernière
 * collecte, donc une vraie heure, pas une heure fabriquée.
 */
export function getScanStatus() {
  const persisted = readPersisted();
  if (persisted.lastScanAt) return { scanning, ...persisted };

  let lastScanAt = null;
  try {
    lastScanAt = fs.statSync(HISTORY_PATH).mtime.toISOString();
  } catch {
    // Pas d'historique du tout (tout premier démarrage) : reste à null.
  }
  return { scanning, lastScanAt, lastScanError: null };
}

export function markScanStarted() {
  scanning = true;
}

export function markScanFinished(error = null) {
  scanning = false;
  const status = { lastScanAt: new Date().toISOString(), lastScanError: error };
  try {
    fs.mkdirSync(path.dirname(SCAN_STATUS_PATH), { recursive: true });
    fs.writeFileSync(SCAN_STATUS_PATH, JSON.stringify(status, null, 2));
  } catch (e) {
    console.error('Erreur d\'écriture du statut de scan :', e.message);
  }
}
