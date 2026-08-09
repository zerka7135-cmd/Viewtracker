import fs from 'fs';
import path from 'path';
import { config } from '../src/config.js';
import { runMigrations, query, withTransaction } from '../src/db.js';
import { getDefaultOrgId } from '../src/org.js';

// Import unique et idempotent des données réelles actuellement dans
// data/*.json vers la base Postgres partagée (creator_leaderboard, voir
// migrations/003_viewtracker_bot.sql). Ne touche jamais aux organisations
// de démo existantes ("Studio Clip", "Test") : tout est écrit dans
// l'organisation par défaut du bot (voir src/org.js#getDefaultOrgId,
// résolue via DISCORD_GUILD_ID). Peut être relancé sans dupliquer
// (upserts partout).

const PLATFORM_HOSTS = [['ig', 'instagram.com'], ['tt', 'tiktok.com'], ['yt', 'youtube.com']];
const DB_PLATFORM = { ig: 'instagram', tt: 'tiktok', yt: 'youtube' };
const APP_PLATFORM = { instagram: 'ig', tiktok: 'tt', youtube: 'yt' };

function readJson(relPath) {
  const full = path.resolve(relPath);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function detectPlatform(url) {
  const match = PLATFORM_HOSTS.find(([, host]) => url.includes(host));
  return match ? match[0] : null;
}

function extractHandle(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.replace(/^\/@?/, '').replace(/\/$/, '') || null;
  } catch {
    return null;
  }
}

async function importAccounts(orgId) {
  const accounts = readJson('./data/accounts.json') || config.accounts || [];
  let creatorsCount = 0;
  let trackedCount = 0;

  for (const account of accounts) {
    const creatorRes = await query(
      `INSERT INTO creators (organization_id, name) VALUES ($1, $2)
       ON CONFLICT (organization_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [orgId, account.name]
    );
    const creatorId = creatorRes.rows[0].id;
    creatorsCount++;

    for (const url of account.urls || []) {
      if (!url) continue;
      const appPlatform = detectPlatform(url);
      const handle = appPlatform ? extractHandle(url) : null;
      if (!appPlatform || !handle) continue;

      await query(
        `INSERT INTO tracked_accounts (organization_id, creator_id, platform, handle, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (organization_id, platform, handle) DO UPDATE SET creator_id = EXCLUDED.creator_id`,
        [orgId, creatorId, DB_PLATFORM[appPlatform], handle]
      );
      trackedCount++;
    }
  }

  console.log(`Comptes : ${creatorsCount} créateur(s), ${trackedCount} tracked_account(s).`);
}

async function trackedAccountLookup(orgId) {
  const { rows } = await query(
    `SELECT ta.id, ta.platform, c.name AS creator_name
     FROM tracked_accounts ta
     JOIN creators c ON c.id = ta.creator_id
     WHERE c.organization_id = $1`,
    [orgId]
  );
  return new Map(rows.map((r) => [`${r.creator_name}:${APP_PLATFORM[r.platform]}`, r.id]));
}

// Ancre à midi UTC : quel que soit le fuseau du bot (Europe/Paris...),
// cette heure ne peut jamais retomber sur la veille/le lendemain une fois
// réinterprétée — contrairement à minuit, qui décalerait le jour affiché
// selon le fuseau de lecture (voir history.js#dateKeyInTimezone).
function noonUtc(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`);
}

async function upsertSnapshot(trackedAccountId, dateStr, views, payload) {
  const dayStart = new Date(`${dateStr}T00:00:00Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59Z`);

  const existing = await query(
    `SELECT id FROM snapshots WHERE tracked_account_id = $1 AND granularity = 'raw' AND captured_at BETWEEN $2 AND $3 LIMIT 1`,
    [trackedAccountId, dayStart, dayEnd]
  );

  if (existing.rows.length > 0) {
    await query('UPDATE snapshots SET views = $1, raw_payload = $2 WHERE id = $3', [views, JSON.stringify(payload), existing.rows[0].id]);
  } else {
    await query(
      `INSERT INTO snapshots (tracked_account_id, captured_at, granularity, views, raw_payload)
       VALUES ($1, $2, 'raw', $3, $4)`,
      [trackedAccountId, noonUtc(dateStr), views, JSON.stringify(payload)]
    );
  }
}

async function importHistory(orgId) {
  const history = readJson('./data/history.json') || [];
  const lookup = await trackedAccountLookup(orgId);
  let snapshotCount = 0;

  await withTransaction(async () => {
    for (const entry of history) {
      for (const item of entry.accounts) {
        for (const platform of ['ig', 'tt', 'yt']) {
          if (item[platform] === null || item[platform] === undefined) continue;

          const trackedAccountId = lookup.get(`${item.account}:${platform}`);
          if (!trackedAccountId) continue; // plus de tracked_account pour ce compte/cette plateforme aujourd'hui

          const labels = { ig: 'Instagram', tt: 'TikTok', yt: 'YouTube' };
          const error = (item.errors || []).find((e) => e.platform === labels[platform]);
          const payload = { posts: item.posts?.[platform] || null, error: error?.message || null };

          await upsertSnapshot(trackedAccountId, entry.date, item[platform], payload);
          snapshotCount++;
        }
      }
    }
  });

  console.log(`Historique : ${history.length} jour(s), ${snapshotCount} snapshot(s) upserté(s).`);
}

async function importCumulativeViews(orgId) {
  const cumulative = readJson('./data/cumulative-views.json') || {};
  const { rows } = await query('SELECT id, name FROM creators WHERE organization_id = $1', [orgId]);
  const creatorIdByName = new Map(rows.map((r) => [r.name, r.id]));
  let count = 0;

  for (const [name, v] of Object.entries(cumulative)) {
    const creatorId = creatorIdByName.get(name);
    if (!creatorId) continue;

    await query(
      `INSERT INTO creator_cumulative_views (creator_id, total, ig, tt, yt, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (creator_id) DO UPDATE SET total = EXCLUDED.total, ig = EXCLUDED.ig, tt = EXCLUDED.tt, yt = EXCLUDED.yt, last_updated = EXCLUDED.last_updated`,
      [creatorId, v.total, v.ig, v.tt, v.yt, v.lastUpdated]
    );
    count++;
  }

  console.log(`Cumul all-time : ${count} créateur(s) importé(s).`);
}

async function importLastMessages(orgId) {
  const lastMessages = readJson('./data/last-message.json') || {};
  let count = 0;

  for (const [key, v] of Object.entries(lastMessages)) {
    if (!v?.channelId || !v?.messageId) continue;
    await query(
      `INSERT INTO last_messages (organization_id, key, channel_id, message_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, key) DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id`,
      [orgId, key, v.channelId, v.messageId]
    );
    count++;
  }

  console.log(`Derniers messages Discord : ${count} importé(s).`);
}

(async () => {
  await runMigrations();
  const orgId = await getDefaultOrgId();
  console.log(`Organisation cible : ${orgId} ("Mon Serveur", résolue via DISCORD_GUILD_ID).\n`);

  await importAccounts(orgId);
  await importHistory(orgId);
  await importCumulativeViews(orgId);
  await importLastMessages(orgId);

  console.log('\nImport terminé.');
  process.exit(0);
})().catch((e) => {
  console.error('Erreur pendant l\'import :', e);
  process.exit(1);
});
