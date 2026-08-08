import fs from 'fs';
import path from 'path';

// Sur Railway, LAST_MESSAGE_PATH pointe vers le volume persistant monté sur
// /data (même logique que HISTORY_PATH dans history.js), sinon l'ID du
// message serait perdu à chaque redéploiement et le bot recréerait un
// nouveau message au lieu d'éditer celui de la veille.
const LAST_MESSAGE_PATH = process.env.LAST_MESSAGE_PATH || path.resolve('./data/last-message.json');

/**
 * @returns {{ channelId: string, messageId: string } | null} Le dernier
 * message de résumé envoyé, ou null si aucun n'a encore été enregistré
 * (premier lancement, ou fichier absent/corrompu).
 */
export function loadLastMessage() {
  try {
    if (!fs.existsSync(LAST_MESSAGE_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(LAST_MESSAGE_PATH, 'utf8'));
    if (!parsed || !parsed.channelId || !parsed.messageId) return null;
    return parsed;
  } catch (e) {
    console.error('Erreur de lecture du dernier message Discord, on repart de zéro :', e.message);
    return null;
  }
}

export function saveLastMessage(channelId, messageId) {
  fs.mkdirSync(path.dirname(LAST_MESSAGE_PATH), { recursive: true });
  fs.writeFileSync(LAST_MESSAGE_PATH, JSON.stringify({ channelId, messageId }, null, 2));
}
