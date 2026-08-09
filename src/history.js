import { config } from './config.js';
import { query, withTransaction } from './db.js';

// Historique des collectes, désormais stocké dans la table `snapshots`
// (granularity='raw', une ligne par tracked_account par jour — voir
// migrations/003_viewtracker_bot.sql) plutôt que dans data/history.json.
// loadHistory() reconstruit exactement la forme attendue par
// computeGrowth24h/detectStuckAccounts ci-dessous
// (`[{date, accounts:[{account, ig, tt, yt, total, errors, posts}]}]`),
// qui restent des fonctions pures inchangées — seule l'I/O change.

const MAX_ENTRIES = 90;
const PLATFORM_LABEL = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };
const APP_PLATFORM = { instagram: 'ig', tiktok: 'tt', youtube: 'yt' };
// item.errors (voir instagram.js#buildViewsSummary) utilise les noms
// affichés ("Instagram"/"TikTok"/"YouTube"), pas les codes internes ig/tt/yt.
const APP_TO_LABEL = { ig: 'Instagram', tt: 'TikTok', yt: 'YouTube' };

/** Date au format YYYY-MM-DD, dans le fuseau donné (cf. config.timezone). */
function dateKeyInTimezone(date, timezone) {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}

/** Date du jour au format YYYY-MM-DD, dans le fuseau configuré. */
export function todayKey(timezone = config.timezone) {
  return dateKeyInTimezone(new Date(), timezone);
}

/**
 * Charge l'historique des collectes précédentes pour une organisation.
 * @param {string} orgId
 * @returns {Promise<Array<{date: string, accounts: Array}>>} trié du plus ancien au plus récent
 */
export async function loadHistory(orgId) {
  const { rows } = await query(
    `SELECT c.id AS creator_id, c.name AS creator_name, ta.platform,
            s.captured_at, s.views, s.raw_payload
     FROM creators c
     JOIN tracked_accounts ta ON ta.creator_id = c.id
     JOIN snapshots s ON s.tracked_account_id = ta.id AND s.granularity = 'raw'
     WHERE c.organization_id = $1
     ORDER BY s.captured_at`,
    [orgId]
  );

  // date -> creatorId -> entrée en construction
  const byDate = new Map();

  for (const row of rows) {
    const date = dateKeyInTimezone(new Date(row.captured_at), config.timezone);
    if (!byDate.has(date)) byDate.set(date, new Map());
    const dayAccounts = byDate.get(date);

    if (!dayAccounts.has(row.creator_id)) {
      dayAccounts.set(row.creator_id, {
        account: row.creator_name,
        ig: null, tt: null, yt: null, total: 0,
        errors: [],
        posts: { ig: null, tt: null, yt: null }
      });
    }
    const entry = dayAccounts.get(row.creator_id);
    const appPlatform = APP_PLATFORM[row.platform];
    const payload = row.raw_payload || {};

    entry[appPlatform] = row.views === null ? 0 : Number(row.views);
    entry.posts[appPlatform] = payload.posts || null;
    if (payload.error) entry.errors.push({ platform: PLATFORM_LABEL[row.platform], message: payload.error });
  }

  const history = [...byDate.entries()]
    .map(([date, dayAccounts]) => ({
      date,
      accounts: [...dayAccounts.values()].map((a) => ({ ...a, total: (a.ig || 0) + (a.tt || 0) + (a.yt || 0) }))
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_ENTRIES);

  return history;
}

/**
 * Enregistre le résumé du jour (résultat de buildViewsSummary) — upsert un
 * snapshot "raw" par tracked_account existant pour chaque compte scrapé,
 * pour rester idempotent si `npm run scan` est relancé le même jour.
 * @param {string} orgId
 * @param {Array} history Ignoré ici (gardé pour compatibilité de signature
 *   avec l'ancienne version fichier — l'historique est relu depuis la DB
 *   par les appelants qui en ont besoin après coup, voir scanCycle.js)
 * @param {Array} summary Résumé du jour (retour de buildViewsSummary)
 */
export async function appendToday(orgId, summary) {
  const { rows } = await query(
    `SELECT ta.id, ta.platform, c.id AS creator_id, c.name AS creator_name
     FROM tracked_accounts ta
     JOIN creators c ON c.id = ta.creator_id
     WHERE c.organization_id = $1`,
    [orgId]
  );
  const trackedAccountId = new Map(rows.map((r) => [`${r.creator_name}:${APP_PLATFORM[r.platform]}`, r.id]));

  await withTransaction(async (client) => {
    for (const item of summary) {
      for (const platform of ['ig', 'tt', 'yt']) {
        if (item[platform] === null) continue; // pas de compte sur cette plateforme ("Ban") : rien à enregistrer

        const taId = trackedAccountId.get(`${item.account}:${platform}`);
        if (!taId) continue; // compte supprimé/renommé entre le chargement et l'écriture : ignoré plutôt que planter

        const error = (item.errors || []).find((e) => e.platform === APP_TO_LABEL[platform]);
        const payload = { posts: item.posts?.[platform] || null, error: error?.message || null };

        // Idempotence par jour (fuseau du bot, pas celui de la session
        // Postgres) : une même journée ne doit produire qu'un seul
        // snapshot "raw" par tracked_account, quel que soit le nombre de
        // fois où `npm run scan`/le cron tournent ce jour-là.
        const todayStart = new Date(`${todayKey()}T00:00:00`);
        const existing = await client.query(
          `SELECT id FROM snapshots WHERE tracked_account_id = $1 AND granularity = 'raw' AND captured_at >= $2 ORDER BY captured_at DESC LIMIT 1`,
          [taId, todayStart]
        );

        if (existing.rows.length > 0) {
          await client.query('UPDATE snapshots SET views = $1, raw_payload = $2, captured_at = now() WHERE id = $3', [
            item[platform], JSON.stringify(payload), existing.rows[0].id
          ]);
        } else {
          await client.query(
            `INSERT INTO snapshots (tracked_account_id, captured_at, granularity, views, raw_payload)
             VALUES ($1, now(), 'raw', $2, $3)`,
            [taId, item[platform], JSON.stringify(payload)]
          );
        }
      }
    }
  });

  return loadHistory(orgId);
}

/**
 * Calcule les vues gagnées dans les dernières 24h, par plateforme, entre
 * aujourd'hui et la collecte de la veille (ou la plus ancienne disponible
 * si l'historique est encore trop jeune) — toujours sur 1 jour, contrairement
 * à computeGrowth() dont le lookback est configurable.
 *
 * Ne suit que les 2 derniers posts par plateforme (voir config.postsLimit),
 * donc le contenu de cette fenêtre change dès qu'un compte publie : sommer
 * les totaux bruts d'un jour à l'autre confondrait "vidéo remplacée dans le
 * top N" et "perte de vues". On compare donc les vidéos individuellement par
 * ID (voir instagram.js#buildViewsSummary → `posts`) : une vidéo déjà vue
 * hier ne compte que sa vraie progression, une vidéo neuve apporte ses vues
 * telles quelles (elle vient forcément d'être publiée, la fenêtre étant si
 * étroite). Si l'ID n'a pas pu être extrait ce jour-là (repli texte sans
 * lien fiable, ou données d'avant cette fonctionnalité), on retombe sur
 * l'ancien calcul par total brut pour cette plateforme. Dans tous les cas,
 * un delta n'est jamais négatif à l'affichage (un compte temporairement
 * banni ne doit pas apparaître comme une "perte de vues").
 * @param {Array} history Historique *avant* ajout du jour (baseline uniquement)
 * @param {Array} summary Résumé du jour
 * @returns {Map<string, {total: number, ig: number, tt: number, yt: number}>}
 */
export function computeGrowth24h(history, summary) {
  const result = new Map();
  if (history.length === 0) return result;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const targetKey = yesterday.toLocaleDateString('en-CA', { timeZone: config.timezone });

  const candidates = history.filter(h => h.date <= targetKey);
  const baseline = candidates.length > 0 ? candidates[candidates.length - 1] : history[0];
  if (!baseline) return result;

  const diff = (curr, prev) => {
    if (typeof curr !== 'number' || typeof prev !== 'number') return 0;
    return Math.max(0, curr - prev);
  };

  // Delta par plateforme pour un compte : suivi par vidéo si les deux
  // collectes ont pu extraire des IDs, sinon repli sur le total brut.
  const platformDelta = (currentPosts, previousPosts, currentTotal, previousTotal) => {
    if (!Array.isArray(currentPosts) || currentPosts.length === 0) {
      return diff(currentTotal, previousTotal);
    }

    const previousViewsById = new Map(
      (Array.isArray(previousPosts) ? previousPosts : []).map(p => [p.id, p.views])
    );

    let sum = 0;
    for (const post of currentPosts) {
      const previousViews = previousViewsById.get(post.id);
      sum += typeof previousViews === 'number' ? Math.max(0, post.views - previousViews) : post.views;
    }
    return sum;
  };

  for (const item of summary) {
    const previous = baseline.accounts.find(a => a.account === item.account);
    if (!previous) continue;

    const ig = platformDelta(item.posts?.ig, previous.posts?.ig, item.ig, previous.ig);
    const tt = platformDelta(item.posts?.tt, previous.posts?.tt, item.tt, previous.tt);
    const yt = platformDelta(item.posts?.yt, previous.posts?.yt, item.yt, previous.yt);

    // total = somme des deltas par plateforme, pas un diff séparé sur
    // item.total/previous.total : sinon un compte qui passe banni (IG ou
    // YT à null) entre les deux collectes fait chuter le total brut, ce
    // qui clampe le total global à 0 même si une autre plateforme (ex.
    // TikTok) a réellement gagné des vues sur la période — total à 0
    // affiché à côté d'un détail TT positif, incohérent à l'oeil.
    result.set(item.account, { total: ig + tt + yt, ig, tt, yt });
  }

  return result;
}

/**
 * Détecte les couples compte/plateforme en échec depuis plusieurs
 * collectes consécutives (les entrées les plus récentes de l'historique,
 * en incluant le jour courant) — typiquement un cookie de session expiré
 * ou un sélecteur DOM devenu obsolète, plutôt qu'un raté ponctuel.
 * @param {Array} history Historique *incluant* la collecte du jour
 * @param {number} minDays Nombre de collectes consécutives en échec avant alerte
 * @returns {Array<{account: string, platform: string, days: number, lastMessage: string}>}
 */
export function detectStuckAccounts(history, minDays = 3) {
  const stuck = [];
  if (history.length < minDays) return stuck;

  const recent = history.slice(-minDays);
  const accounts = recent[recent.length - 1].accounts.map(a => a.account);

  for (const account of accounts) {
    const platformErrors = new Map(); // platform -> messages consécutifs

    for (const entry of recent) {
      const item = entry.accounts.find(a => a.account === account);
      const errors = item?.errors || [];
      // Set : une collecte ne doit compter que pour 1 jour d'échec par
      // plateforme, même si plusieurs tentatives ont échoué dans le run.
      const platformsInErrors = new Set(errors.map(e => e.platform));

      for (const platform of platformsInErrors) {
        const lastMessage = errors.find(e => e.platform === platform).message;
        platformErrors.set(platform, (platformErrors.get(platform) || 0) + 1);
        platformErrors.set(`${platform}:last`, lastMessage);
      }
    }

    for (const [platform, count] of platformErrors) {
      if (platform.endsWith(':last')) continue;
      if (count >= minDays) {
        stuck.push({
          account,
          platform,
          days: count,
          lastMessage: platformErrors.get(`${platform}:last`)
        });
      }
    }
  }

  return stuck;
}
