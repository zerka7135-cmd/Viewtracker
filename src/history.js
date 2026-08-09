import fs from 'fs';
import path from 'path';
import { config } from './config.js';

// Sur Railway, HISTORY_PATH pointe vers le volume persistant monté sur
// /data (sinon le fichier serait effacé à chaque redéploiement). En local,
// on retombe sur un chemin relatif classique.
const HISTORY_PATH = process.env.HISTORY_PATH || path.resolve('./data/history.json');

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
      errors: item.errors
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
 * Calcule la croissance du total de vues par compte entre aujourd'hui et
 * la collecte la plus proche d'il y a `lookbackDays` jours (au plus tôt
 * disponible dans l'historique si l'ancienneté est insuffisante).
 * @param {Array} history Historique *avant* ajout du jour (baseline uniquement)
 * @param {Array} summary Résumé du jour
 * @param {number} lookbackDays
 * @returns {Map<string, {delta: number, percent: number|null, baselineDate: string}>}
 */
export function computeGrowth(history, summary, lookbackDays = 7) {
  const growth = new Map();
  if (history.length === 0) return growth;

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - lookbackDays);
  const targetKey = targetDate.toLocaleDateString('en-CA', { timeZone: config.timezone });

  // Entrée la plus proche de la cible, sans la dépasser (le passé le plus
  // récent disponible avant/à la date cible) — sinon la plus ancienne
  // disponible si l'historique est encore trop jeune.
  const candidates = history.filter(h => h.date <= targetKey);
  const baseline = candidates.length > 0 ? candidates[candidates.length - 1] : history[0];
  if (!baseline) return growth;

  for (const item of summary) {
    const previous = baseline.accounts.find(a => a.account === item.account);
    if (!previous || typeof previous.total !== 'number') continue;

    const delta = item.total - previous.total;
    const percent = previous.total > 0 ? (delta / previous.total) * 100 : null;
    growth.set(item.account, { delta, percent, baselineDate: baseline.date });
  }

  return growth;
}

/**
 * Calcule les vues gagnées dans les dernières 24h, par plateforme, entre
 * aujourd'hui et la collecte de la veille (ou la plus ancienne disponible
 * si l'historique est encore trop jeune) — toujours sur 1 jour, contrairement
 * à computeGrowth() dont le lookback est configurable. Les deltas ne sont
 * jamais négatifs à l'affichage (une vidéo qui sort du top N ou un compte
 * temporairement banni ne doit pas apparaître comme une "perte de vues").
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

  for (const item of summary) {
    const previous = baseline.accounts.find(a => a.account === item.account);
    if (!previous) continue;

    const ig = diff(item.ig, previous.ig);
    const tt = diff(item.tt, previous.tt);
    const yt = diff(item.yt, previous.yt);

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
 * Détecte les comptes dont le total du jour dépasse leur meilleur total
 * jamais enregistré. Un compte sans historique préalable n'est jamais
 * considéré comme un record (sinon chaque nouveau compte "battrait un
 * record" dès sa première collecte, ce qui n'a pas de sens).
 * @param {Array} historyBefore Historique *avant* ajout du jour
 * @param {Array} summary Résumé du jour
 * @returns {Set<string>} noms des comptes en record aujourd'hui
 */
export function detectRecords(historyBefore, summary) {
  const records = new Set();

  for (const item of summary) {
    if (typeof item.total !== 'number' || item.total <= 0) continue;

    const previousTotals = historyBefore
      .map(entry => entry.accounts.find(a => a.account === item.account))
      .filter(Boolean)
      .map(a => a.total)
      .filter(t => typeof t === 'number');

    if (previousTotals.length === 0) continue;
    if (item.total > Math.max(...previousTotals)) records.add(item.account);
  }

  return records;
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
