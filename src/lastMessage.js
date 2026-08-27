import fs from 'fs';
import path from 'path';

// Sur Railway, LAST_MESSAGE_PATH pointe vers le volume persistant monté sur
// /data (même logique que HISTORY_PATH dans history.js), sinon l'ID du
// message serait perdu à chaque redéploiement et le bot recréerait un
// nouveau message au lieu d'éditer celui de la veille.
export const LAST_MESSAGE_PATH = process.env.LAST_MESSAGE_PATH || path.resolve('./data/last-message.json');

/**
 * Un seul fichier peut suivre plusieurs messages édités indépendamment
 * (ex. "daily" pour le leaderboard du jour, "allTime" pour le classement
 * cumulé) — chacun sous sa propre clé.
 * @param {string} key Identifiant du message suivi (ex. "daily", "allTime")
 * @returns {{ channelId: string, messageId: string } | null}
 */
export function loadLastMessage(key) {
  try {
    if (!fs.existsSync(LAST_MESSAGE_PATH)) return null;
    const all = JSON.parse(fs.readFileSync(LAST_MESSAGE_PATH, 'utf8'));
    const entry = all?.[key];
    if (!entry || !entry.channelId || !entry.messageId) return null;
    return entry;
  } catch (e) {
    console.error('Erreur de lecture du dernier message Discord, on repart de zéro :', e.message);
    return null;
  }
}

export function saveLastMessage(key, channelId, messageId) {
  fs.mkdirSync(path.dirname(LAST_MESSAGE_PATH), { recursive: true });

  let all = {};
  try {
    if (fs.existsSync(LAST_MESSAGE_PATH)) all = JSON.parse(fs.readFileSync(LAST_MESSAGE_PATH, 'utf8')) || {};
  } catch {
    // Fichier corrompu : on repart d'un objet vide plutôt que de bloquer l'écriture.
  }

  all[key] = { channelId, messageId };
  fs.writeFileSync(LAST_MESSAGE_PATH, JSON.stringify(all, null, 2));
}
