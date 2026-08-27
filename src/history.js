import fs from 'fs';
import path from 'path';
import { config } from './config.js';

// Sur Railway, HISTORY_PATH pointe vers le volume persistant monté sur
// /data (sinon le fichier serait effacé à chaque redéploiement). En local,
// on retombe sur un chemin relatif classique.
export const HISTORY_PATH = process.env.HISTORY_PATH || path.resolve('./data/history.json');

// Nombre d'entrées (jours de collecte) conservées avant purge des plus
// anciennes — largement suffisant pour les tendances, sans laisser le
// fichier grossir indéfiniment.
const MAX_ENTRIES = 90;

/** Date du jour au format YYYY-MM-DD, dans le fuseau configuré (cf. config.timezone). */
export function todayKey(timezone = config.timezone) {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

/**
 * Charge l'historique des collectes précédentes.
 * @returns {Array<{date: string, accounts: Array}>} trié du plus ancien au plus récent
 */
export function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    // Un historique corrompu ne doit jamais faire planter la collecte du
    // jour : on repart d'un historique vide plutôt que de crasher.
    console.error('Erreur de lecture de l\'historique, on repart de zéro :', e.message);
    return [];
  }
}

/**
 * Ajoute (ou remplace, si déjà présente) l'entrée du jour et persiste le
 * résultat. Remplacer plutôt que dupliquer permet de relancer `npm run scan`
 * plusieurs fois le même jour sans fausser l'historique.
 * @param {Array} history Résultat de loadHistory()
 * @param {Array} summary Résumé du jour (retour de buildViewsSummary)
 * @returns {Array} l'historique mis à jour
 */
export function appendToday(history, summary) {
  const date = todayKey();
  const entry = {
    date,
    accounts: summary.map(item => ({
      account: item.account,
      ig: item.ig,
      tt: item.tt,
      yt: item.yt,
      total: item.total,
      errors: item.errors,
      // Détail par vidéo (id -> vues), pour comparer les mêmes vidéos d'un
      // jour à l'autre plutôt que la somme brute d'une fenêtre glissante —
      // voir computeGrowth24h ci-dessous.
      posts: item.posts || null
    }))
  };

  const withoutToday = history.filter(h => h.date !== date);
  const updated = [...withoutToday, entry]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_ENTRIES);

  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(updated, null, 2));

  return updated;
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
