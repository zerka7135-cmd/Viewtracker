import { query, withTransaction } from './db.js';
import { todayKey } from './history.js';

// Cumul "all time" par créateur, désormais stocké dans
// creator_cumulative_views (voir migrations/003_viewtracker_bot.sql)
// plutôt que dans data/cumulative-views.json. updateCumulativeViews reste
// une fonction pure inchangée — seule l'I/O (load/save) change.

/**
 * @param {string} orgId
 * @returns {Promise<Record<string, {total: number, ig: number, tt: number, yt: number, lastUpdated: string}>>}
 * Cumul "all time" par compte, plateforme par plateforme. {} si rien n'a
 * encore été enregistré.
 */
export async function loadCumulativeViews(orgId) {
  const { rows } = await query(
    `SELECT c.name AS creator_name, ccv.total, ccv.ig, ccv.tt, ccv.yt, ccv.last_updated
     FROM creator_cumulative_views ccv
     JOIN creators c ON c.id = ccv.creator_id
     WHERE c.organization_id = $1`,
    [orgId]
  );

  const cumulative = {};
  for (const row of rows) {
    cumulative[row.creator_name] = {
      total: Number(row.total),
      ig: Number(row.ig),
      tt: Number(row.tt),
      yt: Number(row.yt),
      lastUpdated: row.last_updated ? row.last_updated.toISOString().slice(0, 10) : todayKey()
    };
  }
  return cumulative;
}

/**
 * @param {string} orgId
 * @param {Record<string, {total: number, ig: number, tt: number, yt: number, lastUpdated: string}>} cumulative
 */
export async function saveCumulativeViews(orgId, cumulative) {
  const { rows } = await query(
    `SELECT c.id AS creator_id, c.name FROM creators c WHERE c.organization_id = $1`,
    [orgId]
  );
  const creatorIdByName = new Map(rows.map((r) => [r.name, r.creator_id]));

  await withTransaction(async (client) => {
    for (const [name, v] of Object.entries(cumulative)) {
      const creatorId = creatorIdByName.get(name);
      if (!creatorId) continue; // compte supprimé entre temps : ignoré plutôt que planter

      await client.query(
        `INSERT INTO creator_cumulative_views (creator_id, total, ig, tt, yt, last_updated)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (creator_id) DO UPDATE SET total = EXCLUDED.total, ig = EXCLUDED.ig, tt = EXCLUDED.tt, yt = EXCLUDED.yt, last_updated = EXCLUDED.last_updated`,
        [creatorId, v.total, v.ig, v.tt, v.yt, v.lastUpdated]
      );
    }
  });
}

/**
 * Met à jour le cumul "all time" à partir des vues gagnées dans les
 * dernières 24h (`growth24h`, voir history.js#computeGrowth24h) : même
 * mécanisme que le leaderboard "Last 24h" — ce qui est affiché comme gagné
 * aujourd'hui est ce qui s'ajoute au cumul, jamais le total brut (sinon les
 * mêmes vidéos seraient recomptées en entier chaque jour). Un delta négatif
 * n'est jamais soustrait : le all-time ne peut que monter.
 *
 * Idempotent par jour (`lastUpdated` par compte) : relancer `npm run scan`
 * plusieurs fois le même jour, ou un cron qui se déclenche deux fois, ne
 * doit ajouter la progression qu'une seule fois.
 *
 * Pour un compte jamais vu jusqu'ici (absent de `cumulative`), le total du
 * jour sert de point de départ — la meilleure estimation disponible des vues
 * déjà faites avant le début du suivi.
 *
 * @param {Record<string, {total: number, ig: number, tt: number, yt: number, lastUpdated: string}>} cumulative État actuel
 * @param {Map<string, {total: number, ig: number, tt: number, yt: number}>} growth24h Voir history.js#computeGrowth24h
 * @param {Array<{account: string, ig: number|null, tt: number|null, yt: number|null, total: number}>} summary Résumé du jour
 * @returns {Record<string, {total: number, ig: number, tt: number, yt: number, lastUpdated: string}>} Le cumul mis à jour (nouvel objet, n'altère pas `cumulative`)
 */
export function updateCumulativeViews(cumulative, growth24h, summary) {
  const updated = { ...cumulative };
  const today = todayKey();

  for (const item of summary) {
    if (typeof item.total !== 'number') continue;

    const existing = updated[item.account];
    if (existing && existing.lastUpdated === today) continue; // déjà compté aujourd'hui

    if (!existing) {
      // Premier jour de suivi pour ce compte : le total du jour sert de
      // point de départ (null/"Ban" ne contribue pour rien).
      updated[item.account] = {
        total: item.total,
        ig: typeof item.ig === 'number' ? item.ig : 0,
        tt: typeof item.tt === 'number' ? item.tt : 0,
        yt: typeof item.yt === 'number' ? item.yt : 0,
        lastUpdated: today
      };
      continue;
    }

    const g = growth24h.get(item.account);
    updated[item.account] = {
      total: existing.total + (g?.total || 0),
      ig: existing.ig + (g?.ig || 0),
      tt: existing.tt + (g?.tt || 0),
      yt: existing.yt + (g?.yt || 0),
      lastUpdated: today
    };
  }

  return updated;
}
