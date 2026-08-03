import { Client, GatewayIntentBits } from 'discord.js';
import cron from 'node-cron';
import { config, validateConfig } from './config.js';
import { buildViewsSummary } from './instagram.js';
import { buildLeaderboardEmbed } from './embed.js';
import { saveSummary, loadSummary, acquireLock, releaseLock } from './cache.js';

validateConfig();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function scrapeAndBroadcast(channelId) {
  if (!acquireLock()) {
    console.error('Une collecte est déjà en cours (scan manuel probable). Cycle cron ignoré.');
    return false;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    const summary = await buildViewsSummary();
    saveSummary(summary);
    const embed = buildLeaderboardEmbed(summary, new Date());
    await channel.send({ embeds: [embed] });
    return true;
  } finally {
    releaseLock();
  }
}

// --- Commande manuelle /resume ---
// Répond avec le dernier résumé sauvegardé par la collecte automatique
// (cron), au lieu de relancer un scraping complet à chaque appel :
// réponse instantanée, et pas de risque d'expiration de l'interaction
// Discord (15 min) si la liste de comptes est longue.
client.on('interactionCreate', async (interaction) => {
  console.log(`[interactionCreate] type=${interaction.type} isChatInput=${interaction.isChatInputCommand()} commandName=${interaction.commandName}`);
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'views') return;

  try {
    const cached = loadSummary();

    if (!cached) {
      await interaction.reply(
        "Aucune donnée disponible pour l'instant — la première collecte automatique n'a pas encore eu lieu " +
        `(planifiée : "${config.cronSchedule}", ${config.timezone}). ` +
        "Pour forcer une collecte immédiate, lance `npm run scan` sur le serveur."
      );
      return;
    }

    const embed = buildLeaderboardEmbed(cached.summary, cached.updatedAt);
    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Erreur dans le handler /views :', error);
  }
});

client.on('error', (error) => console.error('Erreur client Discord :', error));
process.on('unhandledRejection', (reason) => console.error('unhandledRejection :', reason));

// --- Planification automatique ---
client.once('clientReady', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  cron.schedule(
    config.cronSchedule,
    async () => {
      // Décale le déclenchement réel de 0 à 45 min après l'heure planifiée :
      // une collecte qui démarre à la seconde près, tous les jours depuis la
      // même IP serveur, est un signal d'automatisation facile à repérer.
      const jitterMs = Math.floor(Math.random() * 45 * 60 * 1000);
      console.log(`Déclenchement cron : collecte différée de ${Math.round(jitterMs / 60000)} min.`);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));

      try {
        const sent = await scrapeAndBroadcast(config.discordChannelId);
        if (sent) console.log('Résumé automatique envoyé et sauvegardé.');
      } catch (error) {
        console.error('Erreur lors de l\'envoi automatique du résumé :', error);
      }
    },
    { timezone: config.timezone }
  );

  console.log(`Planification active : "${config.cronSchedule}" (${config.timezone})`);
});

client.login(config.discordToken);
