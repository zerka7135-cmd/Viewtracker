import { query } from './db.js';
import { config } from './config.js';

// Réglages par organisation, stockés sur la table `organizations` (voir
// migrations/003_viewtracker_bot.sql et 006_org_settings.sql) plutôt que
// dans data/settings.json. discordChannelId/cronSchedule/timezone/
// postsLimit replient sur config.* (.env) quand la colonne DB est NULL —
// ne change donc rien pour une organisation qui n'a jamais touché à ces
// réglages.

const DEFAULT_SETTINGS = {
  notifDaily: true, // envoi/édition des embeds dans le salon Discord public
  notifWarnings: true // DM au propriétaire pour les échecs/comptes bloqués
};

/**
 * @param {string} orgId
 * @returns {Promise<{notifDaily: boolean, notifWarnings: boolean, discordChannelId: string, cronSchedule: string, timezone: string, postsLimit: number}>}
 */
export async function loadSettings(orgId) {
  const { rows } = await query(
    'SELECT notif_daily, notif_warnings, discord_channel_id, discord_owner_id, cron_schedule, timezone, posts_limit FROM organizations WHERE id = $1',
    [orgId]
  );
  if (rows.length === 0) {
    return {
      ...DEFAULT_SETTINGS,
      discordChannelId: config.discordChannelId,
      discordOwnerId: config.discordOwnerId,
      cronSchedule: config.cronSchedule,
      timezone: config.timezone,
      postsLimit: config.postsLimit
    };
  }

  const row = rows[0];
  return {
    notifDaily: row.notif_daily,
    notifWarnings: row.notif_warnings,
    discordChannelId: row.discord_channel_id || config.discordChannelId,
    discordOwnerId: row.discord_owner_id || config.discordOwnerId,
    cronSchedule: row.cron_schedule || config.cronSchedule,
    timezone: row.timezone || config.timezone,
    postsLimit: row.posts_limit || config.postsLimit
  };
}

/**
 * Fusionne `patch` avec les réglages actuels et persiste (voir
 * PATCH /api/settings dans server.js).
 * @param {string} orgId
 * @param {Partial<{notifDaily: boolean, notifWarnings: boolean, discordChannelId: string, cronSchedule: string, timezone: string, postsLimit: number}>} patch
 */
export async function updateSettings(orgId, patch) {
  const current = await loadSettings(orgId);
  const updated = { ...current, ...patch };

  await query(
    `UPDATE organizations
     SET notif_daily = $1, notif_warnings = $2, discord_channel_id = $3, discord_owner_id = $4, cron_schedule = $5, timezone = $6, posts_limit = $7
     WHERE id = $8`,
    [updated.notifDaily, updated.notifWarnings, updated.discordChannelId, updated.discordOwnerId, updated.cronSchedule, updated.timezone, updated.postsLimit, orgId]
  );

  return updated;
}
