import { EmbedBuilder } from 'discord.js';

const medals = ['🥇', '🥈', '🥉'];

/**
 * Construit un embed Discord classé à partir du résumé de vues.
 * Affiche aussi les échecs de scraping (silencieux sinon) sous forme
 * d'un champ dédié, pour ne jamais laisser croire à des stats fiables
 * quand une plateforme n'a pas pu être lue correctement.
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
        const warning = item.errors && item.errors.length > 0 ? ' ⚠️' : '';
        return `${prefix} **${item.account}**${warning}\n${total} vues (IG: ${ig} | TT: ${tt} | YT: ${yt})`;
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

  const accountsWithErrors = sorted.filter(item => item.errors && item.errors.length > 0);
  if (accountsWithErrors.length > 0) {
    let errorText = accountsWithErrors
      .map(item => {
        const details = item.errors.map(e => `${e.platform}: ${e.message}`).join(' · ');
        return `**${item.account}** — ${details}`;
      })
      .join('\n');

    // Limite Discord : 1024 caractères par valeur de champ
    if (errorText.length > 1024) {
      errorText = `${errorText.slice(0, 1000)}…`;
    }

    embed.addFields({
      name: '⚠️ Échecs de scraping détectés',
      value: errorText
    });
    embed.setColor(0xF39C12); // Orange : signale que le résumé contient des données incomplètes
  }

  return embed;
}
