import { EmbedBuilder } from 'discord.js';

const medals = ['🥇', '🥈', '🥉'];

/**
 * Construit un embed Discord classé à partir du résumé de vues, pour le
 * salon public. Volontairement sans aucun détail d'échec de scraping — ça
 * part en message privé à part (voir buildErrorReportEmbed) pour garder ce
 * résumé propre pour tout le monde.
 * @param {Array<{account: string, ig: number, tt: number, yt: number, total: number, errors?: Array<{platform: string, message: string}>}>} summary
 * @param {string|Date|null} updatedAt Horodatage de la collecte (si affiché depuis un cache)
 */
export function buildLeaderboardEmbed(summary, updatedAt = null) {
  const sorted = [...summary].sort((a, b) => b.total - a.total);

  const description = sorted.length
    ? sorted.map((item, index) => {
        const prefix = index < 3 ? medals[index] : `**${index + 1}.**`;
        const total = item.total.toLocaleString('fr-FR');
        const ig = item.ig.toLocaleString('fr-FR');
        const tt = item.tt.toLocaleString('fr-FR');
        const yt = item.yt.toLocaleString('fr-FR');
        return `${prefix} **${item.account}**\n${total} vues (IG: ${ig} | TT: ${tt} | YT: ${yt})`;
      }).join('\n\n')
    : 'Aucune donnée disponible.';

  const embed = new EmbedBuilder()
    .setTitle(`📊 Résumé des vues — ${new Date().toLocaleDateString('fr-FR')}`)
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
