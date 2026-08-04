import { Client, GatewayIntentBits } from 'discord.js';
import cron from 'node-cron';
import { config, validateConfig } from './config.js';
import { buildViewsSummary } from './instagram.js';
import { buildLeaderboardEmbed, buildErrorReportEmbed } from './embed.js';
import { acquireLock, releaseLock } from './cache.js';

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
    const embed = buildLeaderboardEmbed(summary, new Date());
    await channel.send({ embeds: [embed] });
    await sendErrorReportToOwner(summary);
    return true;
  } finally {
    releaseLock();
  }
}

// Les échecs de scraping ne vont plus dans le salon public : seul le
// propriétaire du bot les reçoit en MP, pour garder le résumé quotidien
// propre pour tout le monde d'autre.
async function sendErrorReportToOwner(summary) {
  if (!config.discordOwnerId) return;

  const errorEmbed = buildErrorReportEmbed(summary);
  if (!errorEmbed) return;

  try {
    const owner = await client.users.fetch(config.discordOwnerId);
    await owner.send({ embeds: [errorEmbed] });
  } catch (error) {
    console.error('Erreur lors de l\'envoi du rapport d\'échecs en MP :', error);
  }
}

client.on('error', (error) => console.error('Erreur client Discord :', error));
process.on('unhandledRejection', (reason) => console.error('unhandledRejection :', reason));

// --- Planification automatique ---
client.once('clientReady', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  cron.schedule(
    config.cronSchedule,
    async () => {
      // Décale le déclenchement réel de 0 à 120 min après l'heure planifiée :
      // une collecte qui démarre à la seconde près, tous les jours depuis la
      // même IP serveur, est un signal d'automatisation facile à repérer.
      const jitterMs = Math.floor(Math.random() * 120 * 60 * 1000);
      console.log(`Déclenchement cron : collecte différée de ${Math.round(jitterMs / 60000)} min.`);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));

      try {
        const sent = await scrapeAndBroadcast(config.discordChannelId);
        if (sent) console.log('Résumé automatique envoyé.');
      } catch (error) {
        console.error('Erreur lors de l\'envoi automatique du résumé :', error);
      }
    },
    { timezone: config.timezone }
  );

  console.log(`Planification active : "${config.cronSchedule}" (${config.timezone})`);
});

client.login(config.discordToken);
