import { EmbedBuilder } from 'discord.js';

const medals = ['🥇', '🥈', '🥉'];

// Clé interne (ig/tt/yt) -> nom de plateforme tel qu'enregistré dans
// item.errors par buildViewsSummary (voir instagram.js).
const PLATFORM_LABELS = { ig: 'Instagram', tt: 'TikTok', yt: 'YouTube' };

// Vrai s'il y a eu un échec de scraping enregistré pour cette plateforme lors
// de la collecte du jour (voir buildViewsSummary). scrapeWithRetry ne renvoie
// une erreur que si le total du jour est resté à 0 après épuisement des
// tentatives — un delta à 0 causé par une erreur a donc toujours une entrée
// ici, contrairement à un delta à 0 par simple absence de nouvelles vues.
function hasScrapingError(errors, platformKey) {
  return Boolean(errors?.some(e => e.platform === PLATFORM_LABELS[platformKey]));
}

// null = pas de compte sur cette plateforme (voir buildViewsSummary) : affiché
// "Ban" plutôt qu'un 0 qui laisserait croire à un échec de scraping. Un vrai 0
// sans erreur enregistrée (stagnation réelle, ex. mêmes vidéos qu'hier avec le
// même total de vues) s'affiche tel quel, sans ⚠️ — l'icône ne signale plus
// que les échecs de scraping avérés ce jour-là.
function formatPlatformValue(rawValue, computedValue, hasError) {
  if (rawValue === null) return 'Ban';
  const formatted = computedValue.toLocaleString('fr-FR');
  return hasError ? `⚠️ ${formatted}` : formatted;
}

/**
 * Construit l'embed du classement "Last 24h" : vues gagnées depuis la
 * veille (voir src/history.js#computeGrowth24h), classé indépendamment du
 * cumul all-time — un compte en tête du gain du jour n'est pas forcément
 * en tête du cumul, et inversement.
 * @param {Map<string, {total: number, ig: number, tt: number, yt: number}>} growth24h Voir src/history.js#computeGrowth24h
 * @param {Array<{account: string, ig: number|null, tt: number|null, yt: number|null}>} summary Résumé du jour, pour distinguer "Ban" (null) d'un vrai 0
 * @param {string|Date|null} updatedAt Horodatage de la collecte
 */
export function build24hEmbed(growth24h, summary, updatedAt = null) {
  const rawByAccount = new Map(summary.map(item => [item.account, item]));

  const sorted = [...growth24h.entries()]
    .map(([account, v]) => ({ account, ...v }))
    .sort((a, b) => b.total - a.total);

  const description = sorted.length
    ? sorted.map((item, index) => {
        const prefix = index < 3 ? medals[index] : `**${index + 1}.**`;
        const raw = rawByAccount.get(item.account) || {};
        const total = item.total.toLocaleString('fr-FR');
        const ig = formatPlatformValue(raw.ig, item.ig, hasScrapingError(raw.errors, 'ig'));
        const tt = formatPlatformValue(raw.tt, item.tt, hasScrapingError(raw.errors, 'tt'));
        const yt = formatPlatformValue(raw.yt, item.yt, hasScrapingError(raw.errors, 'yt'));
        return `${prefix} **${item.account}**\n${total} vues (IG: ${ig} | TT: ${tt} | YT: ${yt})`;
      }).join('\n\n')
    : 'Pas encore assez d\'historique pour calculer un gain sur 24h.';

  const embed = new EmbedBuilder()
    .setTitle(`🔥 Classement dernières 24h — ${new Date().toLocaleDateString('fr-FR')}`)
    .setDescription(description)
    .setColor(0xE67E22)
    .setTimestamp();

  if (updatedAt) {
    const date = new Date(updatedAt);
    embed.setFooter({
      text: `Dernière collecte : ${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    });
  }

  return embed;
}

/**
 * Construit l'embed du classement "all time" : cumul des totaux de chaque
 * collecte déjà réalisée depuis le début du suivi (voir
 * src/cumulativeViews.js#updateCumulativeViews), classé indépendamment du
 * leaderboard du jour — un compte en tête du cumul n'est pas forcément en
 * tête du résumé "derniers posts", et inversement.
 * @param {Record<string, {total: number, ig: number, tt: number, yt: number}>} cumulativeViews Voir src/cumulativeViews.js
 * @param {Array<{account: string, ig: number|null, tt: number|null, yt: number|null}>} summary Résumé du jour, pour distinguer "Ban" (compte actuellement absent de cette plateforme) d'un vrai 0
 * @param {string|Date|null} updatedAt Horodatage de la dernière mise à jour du cumul
 */
export function buildAllTimeEmbed(cumulativeViews, summary, updatedAt = null) {
  const rawByAccount = new Map(summary.map(item => [item.account, item]));

  const sorted = Object.entries(cumulativeViews)
    .map(([account, v]) => ({ account, ...v }))
    .sort((a, b) => b.total - a.total);

  let description = sorted.length
    ? sorted.map((item, index) => {
        const prefix = index < 3 ? medals[index] : `**${index + 1}.**`;
        const raw = rawByAccount.get(item.account) || {};
        const total = item.total.toLocaleString('fr-FR');
        const ig = formatPlatformValue(raw.ig, item.ig, hasScrapingError(raw.errors, 'ig'));
        const tt = formatPlatformValue(raw.tt, item.tt, hasScrapingError(raw.errors, 'tt'));
        const yt = formatPlatformValue(raw.yt, item.yt, hasScrapingError(raw.errors, 'yt'));
        return `${prefix} **${item.account}**\n${total} vues (IG: ${ig} | TT: ${tt} | YT: ${yt})`;
      }).join('\n\n')
    : 'Aucune donnée disponible.';

  // Limite Discord : 4096 caractères pour une description d'embed.
  if (description.length > 4000) {
    description = `${description.slice(0, 3960)}…`;
  }

  const embed = new EmbedBuilder()
    .setTitle('♾️ Classement all time — vues cumulées depuis le début du suivi')
    .setDescription(description)
    .setColor(0x9B59B6)
    .setTimestamp();

  if (updatedAt) {
    const date = new Date(updatedAt);
    embed.setFooter({
      text: `Dernière mise à jour : ${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    });
  }

  return embed;
}

/**
 * Construit l'embed des échecs de scraping, destiné à un message privé à
 * l'admin plutôt qu'au salon public. Retourne null s'il n'y a rien à
 * signaler (pas de message envoyé dans ce cas).
 * @param {Array<{account: string, errors?: Array<{platform: string, message: string}>}>} summary
 */
export function buildErrorReportEmbed(summary) {
  const accountsWithErrors = summary.filter(item => item.errors && item.errors.length > 0);
  if (accountsWithErrors.length === 0) return null;

  let errorText = accountsWithErrors
    .map(item => {
      const details = item.errors.map(e => `${e.platform}: ${e.message}`).join(' · ');
      return `**${item.account}** — ${details}`;
    })
    .join('\n');

  // Limite Discord : 4096 caractères pour une description d'embed.
  if (errorText.length > 4000) {
    errorText = `${errorText.slice(0, 3960)}…`;
  }

  return new EmbedBuilder()
    .setTitle('⚠️ Échecs de scraping détectés')
    .setDescription(errorText)
    .setColor(0xF39C12)
    .setTimestamp();
}

/**
 * Construit l'embed d'alerte pour les comptes/plateformes en échec depuis
 * plusieurs collectes consécutives (cookie expiré, sélecteur DOM cassé...),
 * à distinguer d'un raté ponctuel déjà couvert par buildErrorReportEmbed.
 * Destiné lui aussi à un message privé à l'admin. Retourne null s'il n'y a
 * rien à signaler.
 * @param {Array<{account: string, platform: string, days: number, lastMessage: string}>} stuckAccounts Voir src/history.js#detectStuckAccounts
 */
export function buildStuckAccountsEmbed(stuckAccounts) {
  if (!stuckAccounts || stuckAccounts.length === 0) return null;

  const description = stuckAccounts
    .map(s => `**${s.account}** — ${s.platform} en échec depuis ${s.days} collectes consécutives\n↳ ${s.lastMessage}`)
    .join('\n\n');

  return new EmbedBuilder()
    .setTitle('🔴 Comptes bloqués depuis plusieurs jours')
    .setDescription(description)
    .setColor(0xE74C3C)
    .setTimestamp();
}
