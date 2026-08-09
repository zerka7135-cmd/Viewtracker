import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { config } from './config.js';

// Pool de connexion vers la base Postgres existante (voir README, section
// Postgres) — creator_leaderboard en local, DATABASE_URL fourni par
// Railway en production. Aucun ORM : requêtes SQL écrites à la main,
// cohérent avec le reste du projet (history.js, cumulativeViews.js...).
const pool = new pg.Pool({ connectionString: config.databaseUrl });

/** @returns {Promise<import('pg').QueryResult>} */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Exécute `fn` avec un client dédié dans une transaction (BEGIN/COMMIT,
 * ROLLBACK en cas d'erreur) — utilisé pour les upserts qui doivent rester
 * atomiques (voir history.js#appendToday).
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const MIGRATIONS_DIR = path.resolve('./migrations');

// Même forme de table que celle déjà en place dans creator_leaderboard
// (voir plan) : IF NOT EXISTS est un no-op sur la base existante, mais
// permet aussi de démarrer sur une base neuve (ex. tests, autre
// environnement).
async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Applique les fichiers de migrations/*.sql dont le nom n'est pas déjà
 * enregistré dans schema_migrations, dans l'ordre alphabétique (donc
 * numérique grâce au préfixe "NNN_"). N'a aucune connaissance des
 * migrations déjà appliquées par un autre outil (ex. 001_init.sql,
 * 002_invitations.sql, absentes de ce repo) — se contente de ne pas les
 * rejouer puisqu'elles sont déjà dans schema_migrations.
 */
export async function runMigrations() {
  await ensureMigrationsTable();

  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`Application de la migration ${file}...`);
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    });
  }
}
