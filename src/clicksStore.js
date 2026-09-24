import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { todayKey } from './history.js';

// Clics, formulaires remplis (opt-ins) et cash collecté par compte et par
// jour, alimentés de l'extérieur (voir
// clickIngest.js et POST /api/ingest/clicks dans server.js) : le bot ne
// scrape pas les clics, il stocke ce qu'une source lui envoie.
//
// SQLite (module intégré à Node, aucune dépendance native) plutôt qu'un
// fichier JSON comme le reste des données : les clics sont une table de
// lignes (compte, jour, source) qu'on additionne et qu'on remplace à la
// demande, pas un document unique réécrit en entier à chaque envoi.
//
// Sur Railway, CLICKS_DB_PATH pointe vers le volume persistant /data (même
// logique que HISTORY_PATH dans history.js), sinon la base serait effacée à
// chaque redéploiement.
export const CLICKS_DB_PATH = process.env.CLICKS_DB_PATH || path.resolve('./data/clicks.db');

let db = null;

function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(CLICKS_DB_PATH), { recursive: true });
  db = new DatabaseSync(CLICKS_DB_PATH);
  // Clé (compte, jour, source) : renvoyer le même jour remplace la valeur
  // au lieu de la cumuler, donc un envoi rejoué ne double pas les clics.
  db.exec(`
    CREATE TABLE IF NOT EXISTS clicks_daily (
      account    TEXT NOT NULL,
      date       TEXT NOT NULL,
      source     TEXT NOT NULL,
      clicks     INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
      forms      INTEGER NOT NULL DEFAULT 0 CHECK (forms >= 0),
      cash_cents INTEGER NOT NULL DEFAULT 0 CHECK (cash_cents >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account, date, source)
    );
    CREATE INDEX IF NOT EXISTS idx_clicks_daily_date ON clicks_daily (date);
  `);
  // Base créée avant l'ajout des formulaires et du cash : on complète la table.
  const columns = db.prepare('PRAGMA table_info(clicks_daily)').all().map(c => c.name);
  if (!columns.includes('forms')) db.exec('ALTER TABLE clicks_daily ADD COLUMN forms INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('cash_cents')) db.exec('ALTER TABLE clicks_daily ADD COLUMN cash_cents INTEGER NOT NULL DEFAULT 0');
  return db;
}

/** Date YYYY-MM-DD, `daysAgo` jours avant aujourd'hui (fuseau du bot). */
function dateDaysAgo(daysAgo) {
  const [y, m, d] = todayKey().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - daysAgo)).toISOString().slice(0, 10);
}

/**
 * Enregistre (ou remplace) les valeurs reçues, en une seule transaction : un
 * lot est pris en entier ou pas du tout. Un champ absent (`null`/`undefined`)
 * laisse la valeur déjà enregistrée intacte : envoyer seulement les clics
 * d'un jour n'efface ni les formulaires ni le cash de ce jour.
 * @param {Array<{account: string, date: string, source: string,
 *   clicks?: number|null, forms?: number|null, cashCents?: number|null}>} rows
 * @returns {number} nombre de lignes écrites
 */
export function upsertClicks(rows) {
  if (rows.length === 0) return 0;
  const database = open();
  const stmt = database.prepare(`
    INSERT INTO clicks_daily (account, date, source, clicks, forms, cash_cents, updated_at)
    VALUES ($account, $date, $source, COALESCE($clicks, 0), COALESCE($forms, 0), COALESCE($cash, 0), $now)
    ON CONFLICT (account, date, source) DO UPDATE SET
      clicks = COALESCE($clicks, clicks),
      forms = COALESCE($forms, forms),
      cash_cents = COALESCE($cash, cash_cents),
      updated_at = $now
  `);
  const now = new Date().toISOString();

  database.exec('BEGIN');
  try {
    for (const r of rows) {
      stmt.run({
        account: r.account, date: r.date, source: r.source, now,
        clicks: r.clicks ?? null, forms: r.forms ?? null, cash: r.cashCents ?? null
      });
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return rows.length;
}

/**
 * Clics par compte : sur les 7 derniers jours (aujourd'hui compris) et
 * depuis toujours.
 * @returns {Map<string, {last7d: number, allTime: number}>}
 */
export function getClickTotals() {
  if (!fs.existsSync(CLICKS_DB_PATH)) return new Map();
  const rows = open().prepare(`
    SELECT account,
           COALESCE(SUM(CASE WHEN date >= ? THEN clicks END), 0) AS last7d,
           SUM(clicks) AS allTime
    FROM clicks_daily
    GROUP BY account
  `).all(dateDaysAgo(6));

  return new Map(rows.map(r => [r.account, { last7d: Number(r.last7d), allTime: Number(r.allTime) }]));
}

/**
 * Série quotidienne des clics (tous comptes, ou un seul), sur les `days`
 * derniers jours — un point par jour, 0 les jours sans clic.
 * @returns {Array<{date: string, value: number}>}
 */
export function getClicksSeries(days = 14, account = null) {
  const byDate = new Map();
  if (fs.existsSync(CLICKS_DB_PATH)) {
    const rows = open().prepare(`
      SELECT date, SUM(clicks) AS clicks
      FROM clicks_daily
      WHERE date >= ? AND (? IS NULL OR account = ?)
      GROUP BY date
    `).all(dateDaysAgo(days - 1), account, account);
    for (const r of rows) byDate.set(r.date, Number(r.clicks));
  }

  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dateDaysAgo(i);
    series.push({ date, value: byDate.get(date) || 0 });
  }
  return series;
}

/**
 * Clics, formulaires remplis et cash collecté par compte sur une période
 * (bornes incluses ; `null` = sans borne de ce côté).
 * @returns {Map<string, {clicks: number, forms: number, cashCents: number}>}
 */
export function getPeriodTotals(from = null, to = null) {
  if (!fs.existsSync(CLICKS_DB_PATH)) return new Map();
  const rows = open().prepare(`
    SELECT account,
           SUM(clicks) AS clicks, SUM(forms) AS forms, SUM(cash_cents) AS cashCents
    FROM clicks_daily
    WHERE ($from IS NULL OR date >= $from) AND ($to IS NULL OR date <= $to)
    GROUP BY account
  `).all({ from, to });

  return new Map(rows.map(r => [r.account, {
    clicks: Number(r.clicks), forms: Number(r.forms), cashCents: Number(r.cashCents)
  }]));
}

/** Vrai dès qu'au moins une ligne de clics a été reçue. */
export function hasClicks() {
  if (!fs.existsSync(CLICKS_DB_PATH)) return false;
  return open().prepare('SELECT 1 FROM clicks_daily LIMIT 1').get() !== undefined;
}

/**
 * Renomme un compte dans les clics (voir history.js#renameAccountInHistory)
 * — sans ça, l'historique de clics resterait sous l'ancien nom. Sans effet
 * si aucune base n'existe encore. Si le nouveau nom avait déjà des lignes
 * (compte supprimé puis recréé), celles de l'ancien nom les remplacent.
 */
export function renameAccountInClicks(oldName, newName) {
  if (!fs.existsSync(CLICKS_DB_PATH)) return;
  open().prepare('UPDATE OR REPLACE clicks_daily SET account = ? WHERE account = ?').run(newName, oldName);
}
