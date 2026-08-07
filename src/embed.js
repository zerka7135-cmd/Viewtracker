import { EmbedBuilder } from 'discord.js';

const medals = ['🥇', '🥈', '🥉'];

/**
 * Construit un embed Discord classé à partir du résumé de vues, pour le
 * salon public. Volontairement sans aucun détail d'échec de scraping — ça
 * part en message privé à part (voir buildErrorReportEmbed) pour garder ce
 * résumé propre pour tout le monde.
 * @param {Array<{account: string, ig: number, tt: number, yt: number, total: number, errors?: Array<{platform: string, message: string}>}>} summary
 * @param {string|Date|null} updatedAt Horodatage de la collecte (si affiché depuis un cache)
 * @param {Map<string, {delta: number, percent: number|null, baselineDate: string}>} [growth] Voir src/history.js#computeGrowth
 * @param {number} [lookbackDays] Nombre de jours utilisé pour le calcul de croissance (affichage uniquement)
 * @param {Set<string>} [records] Comptes ayant battu leur record aujourd'hui, voir src/history.js#detectRecords
 */
export function buildLeaderboardEmbed(summary, updatedAt = null, growth = new Map(), lookbackDays = 7, records = new Set()) {
  const sorted = [...summary].sort((a, b) => b.total - a.total);

  // null = pas de compte sur cette plateforme (voir buildViewsSummary) :
  // affiché "Ban" plutôt qu'un 0 qui laisserait croire à un échec.
  const formatPlatform = (value) => value === null ? 'Ban' : value.toLocaleString('fr-FR');

  // Pas de flèche tant qu'on n'a pas assez d'historique pour comparer
  // (nouveau compte, ou bot lancé depuis moins de `lookbackDays` jours).
  const formatGrowth = (account) => {
    const g = growth.get(account);
    if (!g) return '';
    const arrow = g.delta > 0 ? '📈' : g.delta < 0 ? '📉' : '➖';
    const sign = g.delta > 0 ? '+' : '';
    const deltaText = `${sign}${g.delta.toLocaleString('fr-FR')}`;
    const percentText = g.percent !== null
      ? ` (${sign}${g.percent.toFixed(1)}%)`
      : ''; // baseline à 0 vue : un pourcentage n'aurait pas de sens
    return `\n${arrow} ${deltaText}${percentText} vs il y a ${lookbackDays}j`;
  };

  const description = sorted.length
    ? sorted.map((item, index) => {
        const prefix = index < 3 ? medals[index] : `**${index + 1}.**`;
        const total = item.total.toLocaleString('fr-FR');
        const ig = formatPlatform(item.ig);
        const tt = formatPlatform(item.tt);
        const yt = formatPlatform(item.yt);
        const recordBadge = records.has(item.account) ? ' 🎉 *Nouveau record !*' : '';
        return `${prefix} **${item.account}**${recordBadge}\n${total} vues (IG: ${ig} | TT: ${tt} | YT: ${yt})${formatGrowth(item.account)}`;
      }).join('\n\n')
    : 'Aucune donnée disponible.';

  const embed = new EmbedBuilder()
    .setTitle(`📊 Résumé des vues sur les 5 derniers posts — ${new Date().toLocaleDateString('fr-FR')}`)
    .setDescription(description)
    .setColor(0x5865F2)
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
