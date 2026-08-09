import { query } from './db.js';

// IDs des messages Discord édités plutôt que renvoyés à chaque collecte,
// désormais stockés dans last_messages (voir
// migrations/003_viewtracker_bot.sql) plutôt que data/last-message.json.

/**
 * Un seul enregistrement par organisation peut suivre plusieurs messages
 * édités indépendamment (ex. "daily" pour le leaderboard du jour,
 * "allTime" pour le classement cumulé) — chacun sous sa propre clé.
 * @param {string} orgId
 * @param {string} key Identifiant du message suivi (ex. "daily", "allTime")
 * @returns {Promise<{ channelId: string, messageId: string } | null>}
 */
export async function loadLastMessage(orgId, key) {
  const { rows } = await query(
    'SELECT channel_id, message_id FROM last_messages WHERE organization_id = $1 AND key = $2',
    [orgId, key]
  );
  if (rows.length === 0) return null;
  return { channelId: rows[0].channel_id, messageId: rows[0].message_id };
}

export async function saveLastMessage(orgId, key, channelId, messageId) {
  await query(
    `INSERT INTO last_messages (organization_id, key, channel_id, message_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, key) DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id`,
    [orgId, key, channelId, messageId]
  );
}
