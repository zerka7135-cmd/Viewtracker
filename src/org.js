import { query } from './db.js';
import { config } from './config.js';

// Résolution du "tenant" par défaut : une seule organisation pour
// l'instant (le bot reste mono-tenant), retrouvée/créée à partir de
// DISCORD_GUILD_ID plutôt que par nom (plus robuste, et déjà présent dans
// .env). Pas de session utilisateur pour choisir l'org — ça, c'est le
// chantier auth (Discord OAuth2 ou email/mot de passe selon la table
// users existante). Les organisations de démo (ex. "Studio Clip", "Test")
// ne sont jamais retournées par cette fonction : seule celle qui
// correspond à DISCORD_GUILD_ID est utilisée/créée.

// DISCORD_GUILD_ID est documenté "optionnel" dans le README (voir
// section 1) : ce sentinel évite de planter si absent, au prix de ne
// gérer qu'un seul déploiement sans guild_id renseigné (cas mono-tenant
// actuel, acceptable).
const GUILD_SENTINEL = 'default';

let cachedOrgId = null;

/** @returns {Promise<string>} id (uuid) de l'organisation par défaut. */
export async function getDefaultOrgId() {
  if (cachedOrgId) return cachedOrgId;

  const guildId = process.env.DISCORD_GUILD_ID || GUILD_SENTINEL;

  const existing = await query('SELECT id FROM organizations WHERE discord_guild_id = $1', [guildId]);
  if (existing.rows.length > 0) {
    cachedOrgId = existing.rows[0].id;
    return cachedOrgId;
  }

  const inserted = await query(
    `INSERT INTO organizations (name, type, discord_guild_id, discord_owner_id, cron_schedule, timezone, notif_daily, notif_warnings)
     VALUES ($1, 'b2b', $2, $3, $4, $5, true, true)
     RETURNING id`,
    [
      'Mon Serveur',
      guildId,
      config.discordOwnerId || null,
      config.cronSchedule,
      config.timezone
    ]
  );

  cachedOrgId = inserted.rows[0].id;
  return cachedOrgId;
}

/** Renomme une organisation (voir PATCH /api/organization dans server.js). */
export async function renameOrganization(orgId, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Nom d\'organisation vide');
  await query('UPDATE organizations SET name = $1 WHERE id = $2', [trimmed, orgId]);
  return trimmed;
}

/**
 * Supprime définitivement une organisation — irréversible. Toutes les
 * tables qui en dépendent (creators, tracked_accounts,
 * creator_cumulative_views via creators, memberships, invitations,
 * last_messages, leaderboard_scores, alert_configs, publish_channels)
 * sont en `ON DELETE CASCADE` sur `organizations`, donc un seul DELETE
 * suffit. Vérifie que `confirmName` correspond exactement au nom actuel
 * (défense en profondeur, en plus de la confirmation déjà faite côté UI —
 * voir DeleteOrganizationModal.jsx) avant de supprimer.
 */
export async function deleteOrganization(orgId, confirmName) {
  const { rows } = await query('SELECT name FROM organizations WHERE id = $1', [orgId]);
  if (rows.length === 0) throw new Error('Organisation introuvable');

  if (rows[0].name !== confirmName) {
    throw new Error('Le nom saisi ne correspond pas au nom de l\'organisation');
  }

  await query('DELETE FROM organizations WHERE id = $1', [orgId]);

  // Si l'organisation par défaut du bot ("Mon Serveur") vient d'être
  // supprimée, on oublie l'id mis en cache : un prochain appel à
  // getDefaultOrgId() en recréera une plutôt que de continuer à pointer
  // vers une organisation qui n'existe plus.
  if (orgId === cachedOrgId) cachedOrgId = null;
}
