import crypto from 'crypto';
import { query } from './db.js';

// Lien en bio trackable par compte suivi — l'utilisateur colle
// `${PUBLIC_URL}/r/<slug>` dans sa bio Instagram/TikTok/YouTube à la
// place du lien réel (landing page, affiliation...) : chaque visite passe
// par GET /r/:slug (voir server.js), qui compte le clic puis redirige
// vers l'URL réelle — mesure la conversion "vues → clics" par compte,
// affichée au même niveau que les vues dans le tableau (voir
// dashboardData.js#getAccountsWithStats).

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans caractères ambigus (0/O, 1/l/I)
const SLUG_LENGTH = 7;

function generateSlug() {
  const bytes = crypto.randomBytes(SLUG_LENGTH);
  return [...bytes].map((b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join('');
}

/**
 * Renseigne (ou efface) le lien en bio d'un compte suivi. Un slug est
 * généré une seule fois, à la première URL renseignée, et conservé même
 * si l'URL est ensuite vidée — pour ne jamais casser un lien déjà collé
 * dans une bio publique en le faisant pointer vers un slug différent.
 * @param {string} orgId
 * @param {string} creatorName
 * @param {string|null} url URL réelle de destination, ou null pour l'effacer
 */
export async function setBioLinkUrl(orgId, creatorName, url) {
  const trimmed = (url || '').trim() || null;

  const { rows } = await query(
    'SELECT id, bio_link_slug FROM creators WHERE organization_id = $1 AND name = $2',
    [orgId, creatorName]
  );
  if (rows.length === 0) return;

  const { id, bio_link_slug: existingSlug } = rows[0];
  const slug = trimmed && !existingSlug ? generateSlug() : existingSlug;

  await query('UPDATE creators SET bio_link_url = $1, bio_link_slug = $2 WHERE id = $3', [trimmed, slug, id]);
}

/**
 * @param {string} orgId
 * @returns {Promise<Map<string, {url: string|null, slug: string|null, clicks: number}>>} par nom de créateur
 */
export async function loadBioLinks(orgId) {
  const { rows } = await query(
    'SELECT name, bio_link_url, bio_link_slug, bio_link_clicks FROM creators WHERE organization_id = $1',
    [orgId]
  );
  return new Map(rows.map((r) => [r.name, { url: r.bio_link_url, slug: r.bio_link_slug, clicks: r.bio_link_clicks }]));
}

/**
 * Appelé par GET /r/:slug (route publique, pas d'auth — voir server.js).
 * Incrémente le compteur de clics et renvoie l'URL de destination, ou
 * `null` si le slug ne correspond à aucun compte (lien expiré/invalide).
 * @param {string} slug
 * @returns {Promise<string|null>}
 */
export async function recordClickAndGetTarget(slug) {
  const { rows } = await query(
    `UPDATE creators SET bio_link_clicks = bio_link_clicks + 1
     WHERE bio_link_slug = $1 AND bio_link_url IS NOT NULL
     RETURNING id, bio_link_url`,
    [slug]
  );
  if (rows.length === 0) return null;

  // Journalisé séparément du compteur (voir migrations/008_bio_link_click_events.sql)
  // pour pouvoir tracer un graphique d'évolution des clics dans le temps
  // (getClicksHistorySeries ci-dessous), le compteur seul ne suffisant pas.
  await query('INSERT INTO bio_link_click_events (creator_id) VALUES ($1)', [rows[0].id]);
  return rows[0].bio_link_url;
}

/**
 * Série quotidienne du nombre de clics, tous comptes confondus (ou
 * filtrée aux comptes ayant une plateforme donnée configurée — un lien en
 * bio est unique par compte, pas par plateforme, donc "filtrer par
 * réseau" restreint quels comptes contribuent au total plutôt que de
 * distinguer la plateforme cliquée). Alimente le graphique "Clics totaux"
 * du Dashboard (mode Clics), même logique que getHistorySeries pour les
 * vues.
 * @param {string} orgId
 * @param {number} days
 * @param {'all'|'ig'|'tt'|'yt'} platform
 * @returns {Promise<Array<{date: string, value: number}>>}
 */
export async function getClicksHistorySeries(orgId, days = 14, platform = 'all') {
  const platformColumn = { ig: 'instagram', tt: 'tiktok', yt: 'youtube' }[platform];

  const { rows } = await query(
    `SELECT (e.clicked_at AT TIME ZONE 'UTC')::date AS day, count(*) AS clicks
     FROM bio_link_click_events e
     JOIN creators c ON c.id = e.creator_id
     WHERE c.organization_id = $1
       AND e.clicked_at >= now() - ($2 || ' days')::interval
       ${platformColumn ? `AND EXISTS (SELECT 1 FROM tracked_accounts ta WHERE ta.creator_id = c.id AND ta.platform = '${platformColumn}')` : ''}
     GROUP BY day
     ORDER BY day`,
    [orgId, days]
  );

  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.clicks)]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, value: byDay.get(key) || 0 });
  }
  return series;
}

/**
 * Série horaire des clics sur les 24 dernières heures (24 points) — plus
 * fine que getClicksHistorySeries qui n'agrège que par jour, utile ici
 * car un clic a une vraie précision seconde (contrairement aux vues qui
 * ne sont collectées qu'une fois par jour, voir
 * dashboardData.js#getHistorySeriesHourly).
 * @param {string} orgId
 * @param {'all'|'ig'|'tt'|'yt'} platform
 * @returns {Promise<Array<{date: string, value: number}>>} `date` = ISO horaire
 */
export async function getClicksHistorySeriesHourly(orgId, platform = 'all') {
  const platformColumn = { ig: 'instagram', tt: 'tiktok', yt: 'youtube' }[platform];

  const { rows } = await query(
    `SELECT date_trunc('hour', e.clicked_at) AS hour, count(*) AS clicks
     FROM bio_link_click_events e
     JOIN creators c ON c.id = e.creator_id
     WHERE c.organization_id = $1
       AND e.clicked_at >= now() - interval '24 hours'
       ${platformColumn ? `AND EXISTS (SELECT 1 FROM tracked_accounts ta WHERE ta.creator_id = c.id AND ta.platform = '${platformColumn}')` : ''}
     GROUP BY hour
     ORDER BY hour`,
    [orgId]
  );

  const byHour = new Map(rows.map((r) => [r.hour.toISOString().slice(0, 13), Number(r.clicks)]));
  const series = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() - i);
    const key = d.toISOString().slice(0, 13);
    series.push({ date: `${key}:00`, value: byHour.get(key) || 0 });
  }
  return series;
}
