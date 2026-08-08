import { Client, GatewayIntentBits } from 'discord.js';
import cron from 'node-cron';
import { config, validateConfig } from './config.js';
import { buildViewsSummary } from './instagram.js';
import { buildLeaderboardEmbed, buildAllTimeEmbed, buildErrorReportEmbed, buildStuckAccountsEmbed } from './embed.js';
import { acquireLock, releaseLock } from './cache.js';
import { loadHistory, appendToday, computeGrowth, detectStuckAccounts, detectRecords } from './history.js';
import { loadLastMessage, saveLastMessage } from './lastMessage.js';
import { loadCumulativeViews, updateCumulativeViews, saveCumulativeViews } from './cumulativeViews.js';

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

    // L'historique *avant* ajout du jour sert de référence pour le calcul
    // de croissance (comparer aujourd'hui à aujourd'hui n'aurait pas de sens).
    const historyBefore = loadHistory();
    const growth = computeGrowth(historyBefore, summary, config.historyLookbackDays);
    const records = detectRecords(historyBefore, summary);

    // Cumul "all time", classé indépendamment du leaderboard du jour (voir
    // src/cumulativeViews.js) — additionne le total de chaque collecte
    // déjà réalisée, sans jamais repartir de zéro.
    const cumulativeBefore = loadCumulativeViews();
    const cumulativeAfter = updateCumulativeViews(cumulativeBefore, summary);
    saveCumulativeViews(cumulativeAfter);

    const dailyEmbed = buildLeaderboardEmbed(summary, new Date(), growth, config.historyLookbackDays, records);
    await sendOrEditSummary(channel, 'daily', dailyEmbed);

    const allTimeEmbed = buildAllTimeEmbed(cumulativeAfter, new Date());
    await sendOrEditSummary(channel, 'allTime', allTimeEmbed);

    const historyAfter = appendToday(historyBefore, summary);
    await sendErrorReportToOwner(summary);
    await sendStuckAlertToOwner(historyAfter);
    return true;
  } finally {
    releaseLock();
  }
}

// Édite le message de la veille au lieu d'en renvoyer un nouveau à chaque
// cron, pour ne pas empiler un message par jour dans le salon. `key`
// distingue les différents messages suivis (leaderboard du jour, all time...)
// puisqu'ils s'éditent chacun indépendamment. Si l'édition échoue (message
// supprimé manuellement, trop ancien pour Discord, ou premier lancement
// sans message enregistré), on retombe sur un envoi classique et on
// mémorise ce nouveau message pour la prochaine fois.
async function sendOrEditSummary(channel, key, embed) {
  const last = loadLastMessage(key);

  if (last && last.channelId === channel.id) {
    try {
      const message = await channel.messages.fetch(last.messageId);
      await message.edit({ embeds: [embed] });
      return;
    } catch (error) {
      console.error(`Édition du message "${key}" précédent impossible, envoi d'un nouveau message :`, error.message);
    }
  }

  const message = await channel.send({ embeds: [embed] });
  saveLastMessage(key, channel.id, message.id);
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

// Alerte distincte du rapport d'échecs ponctuels ci-dessus : ne se
// déclenche que si un compte/plateforme échoue plusieurs collectes de
// suite (cookie expiré, sélecteur DOM cassé...), signe d'un vrai problème
// à corriger plutôt qu'un raté isolé.
async function sendStuckAlertToOwner(history) {
  if (!config.discordOwnerId) return;

  const stuckAccounts = detectStuckAccounts(history, config.stuckAlertMinDays);
  const stuckEmbed = buildStuckAccountsEmbed(stuckAccounts);
  if (!stuckEmbed) return;

  try {
    const owner = await client.users.fetch(config.discordOwnerId);
    await owner.send({ embeds: [stuckEmbed] });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'alerte comptes bloqués en MP :', error);
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
