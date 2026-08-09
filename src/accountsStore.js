import { query, withTransaction } from './db.js';

// Comptes suivis, désormais stockés en Postgres (creators + tracked_accounts,
// voir migrations/003_viewtracker_bot.sql) plutôt que dans data/accounts.json.
// loadAccounts() reconstruit exactement la forme attendue par
// buildViewsSummary (src/instagram.js) — [{name, urls:[igUrl, ttUrl, ytUrl]}]
// — pour ne rien changer côté scraping.

const PLATFORM_HOSTS = [['ig', 'instagram.com'], ['tt', 'tiktok.com'], ['yt', 'youtube.com']];
const DB_PLATFORM = { ig: 'instagram', tt: 'tiktok', yt: 'youtube' };
const APP_PLATFORM = { instagram: 'ig', tiktok: 'tt', youtube: 'yt' };
const URL_INDEX = { ig: 0, tt: 1, yt: 2 };

function detectPlatform(url) {
  const match = PLATFORM_HOSTS.find(([, host]) => url.includes(host));
  return match ? match[0] : null;
}

/** Extrait le pseudo depuis une URL de profil (ex. "https://www.tiktok.com/@xxx" → "xxx"). */
function extractHandle(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.replace(/^\/@?/, '').replace(/\/$/, '') || null;
  } catch {
    return null;
  }
}

function buildUrl(platform, handle) {
  if (platform === 'ig') return `https://www.instagram.com/${handle}/`;
  if (platform === 'tt') return `https://www.tiktok.com/@${handle}`;
  if (platform === 'yt') return `https://www.youtube.com/@${handle}`;
  return '';
}

/**
 * @param {string} orgId
 * @returns {Promise<Array<{name: string, urls: string[]}>>}
 */
export async function loadAccounts(orgId) {
  const { rows } = await query(
    `SELECT c.id AS creator_id, c.name, ta.platform, ta.handle
     FROM creators c
     LEFT JOIN tracked_accounts ta ON ta.creator_id = c.id
     WHERE c.organization_id = $1
     ORDER BY c.id`,
    [orgId]
  );

  const byCreator = new Map();
  for (const row of rows) {
    if (!byCreator.has(row.creator_id)) {
      byCreator.set(row.creator_id, { name: row.name, urls: ['', '', ''] });
    }
    if (!row.platform) continue;
    const appPlatform = APP_PLATFORM[row.platform];
    byCreator.get(row.creator_id).urls[URL_INDEX[appPlatform]] = buildUrl(appPlatform, row.handle);
  }

  return [...byCreator.values()];
}

/**
 * Ajoute un compte suivi (voir POST /api/accounts dans server.js) : crée un
 * créateur et un tracked_account par URL reconnue (Instagram/TikTok/YouTube).
 * @param {string} orgId
 * @param {string} name
 * @param {string[]} urls Jusqu'à 3 URLs, entrées vides/non reconnues ignorées
 */
export async function addAccount(orgId, name, urls) {
  return withTransaction(async (client) => {
    const creatorRes = await client.query(
      'INSERT INTO creators (organization_id, name) VALUES ($1, $2) RETURNING id',
      [orgId, name]
    );
    const creatorId = creatorRes.rows[0].id;

    for (const url of urls || []) {
      if (!url) continue;
      const appPlatform = detectPlatform(url);
      const handle = appPlatform ? extractHandle(url) : null;
      if (!appPlatform || !handle) continue;

      await client.query(
        `INSERT INTO tracked_accounts (organization_id, creator_id, platform, handle, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (organization_id, platform, handle) DO UPDATE SET creator_id = EXCLUDED.creator_id`,
        [orgId, creatorId, DB_PLATFORM[appPlatform], handle]
      );
    }

    return creatorId;
  });
}

/**
 * Supprime un compte suivi et tout ce qui en dépend. `tracked_accounts.
 * creator_id` est en ON DELETE SET NULL (pas CASCADE, voir
 * migrations/003_viewtracker_bot.sql) : les tracked_accounts sont donc
 * supprimés explicitement plutôt que laissés orphelins.
 * `creator_cumulative_views`, lui, est bien en CASCADE.
 * @param {string} orgId
 * @param {string} name Nom du créateur (identifiant utilisé côté UI, unique par organisation)
 */
export async function deleteAccount(orgId, name) {
  await withTransaction(async (client) => {
    const creator = await client.query('SELECT id FROM creators WHERE organization_id = $1 AND name = $2', [orgId, name]);
    if (creator.rows.length === 0) return; // déjà supprimé : idempotent

    const creatorId = creator.rows[0].id;
    await client.query('DELETE FROM tracked_accounts WHERE creator_id = $1', [creatorId]);
    await client.query('DELETE FROM creators WHERE id = $1', [creatorId]);
  });
}

/**
 * Édite un compte suivi : renomme le créateur si besoin et remplace ses
 * tracked_accounts par les nouvelles URLs (mêmes règles de détection que
 * addAccount — une URL non reconnue/vide retire simplement la plateforme).
 * @param {string} orgId
 * @param {string} currentName Nom actuel (identifiant du créateur à éditer)
 * @param {string} newName Nouveau nom (peut être identique à currentName)
 * @param {string[]} urls Jusqu'à 3 URLs
 */
export async function updateAccount(orgId, currentName, newName, urls) {
  return withTransaction(async (client) => {
    const creator = await client.query('SELECT id FROM creators WHERE organization_id = $1 AND name = $2', [orgId, currentName]);
    if (creator.rows.length === 0) throw new Error('Compte introuvable');
    const creatorId = creator.rows[0].id;

    if (newName && newName !== currentName) {
      await client.query('UPDATE creators SET name = $1 WHERE id = $2', [newName, creatorId]);
    }

    await client.query('DELETE FROM tracked_accounts WHERE creator_id = $1', [creatorId]);
    for (const url of urls || []) {
      if (!url) continue;
      const appPlatform = detectPlatform(url);
      const handle = appPlatform ? extractHandle(url) : null;
      if (!appPlatform || !handle) continue;

      await client.query(
        `INSERT INTO tracked_accounts (organization_id, creator_id, platform, handle, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (organization_id, platform, handle) DO UPDATE SET creator_id = EXCLUDED.creator_id`,
        [orgId, creatorId, DB_PLATFORM[appPlatform], handle]
      );
    }
  });
}
