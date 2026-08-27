import { Client, GatewayIntentBits } from 'discord.js';
import { config, validateConfig } from '../src/config.js';
import { buildViewsSummary } from '../src/instagram.js';
import { build24hEmbed, buildAllTimeEmbed, buildErrorReportEmbed, buildStuckAccountsEmbed } from '../src/embed.js';
import { acquireLock, releaseLock } from '../src/cache.js';
import { loadHistory, appendToday, computeGrowth24h, detectStuckAccounts } from '../src/history.js';
import { loadLastMessage, saveLastMessage } from '../src/lastMessage.js';
import { loadCumulativeViews, updateCumulativeViews, saveCumulativeViews } from '../src/cumulativeViews.js';
import { sendDataBackupToOwner } from '../src/backup.js';
import { loadAccounts } from '../src/accountsStore.js';
import { loadSettings } from '../src/settingsStore.js';
import { markScanStarted, markScanFinished } from '../src/scanStatus.js';

// Déclenche manuellement un seul cycle de collecte + diffusion, en dehors
// du cron planifié. Édite les messages Discord existants comme le ferait
// le cron normal (voir sendOrEditSummary ci-dessous) — n'en crée jamais de
// nouveaux tant que lastMessage.json pointe vers un message éditable :
// utile pour republier des stats corrigées suite à un fix de calcul, sans
// attendre le prochain créneau cron ni dupliquer les messages du salon.
//
// Comptes et réglages viennent des mêmes fichiers que le dashboard
// (accountsStore.js/settingsStore.js), pas de ACCOUNTS/.env directement —
// un compte ajouté depuis le dashboard est donc bien inclus ici.
validateConfig();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function sendOrEditSummary(channel, key, embed) {
  const last = loadLastMessage(key);

  if (last && last.channelId === channel.id) {
    try {
      const message = await channel.messages.fetch(last.messageId);
      await message.edit({ embeds: [embed] });
      console.log(`Message "${key}" édité (id ${message.id}).`);
      return;
    } catch (error) {
      console.error(`Édition du message "${key}" précédent impossible, envoi d'un nouveau message :`, error.message);
    }
  }

  const message = await channel.send({ embeds: [embed] });
  saveLastMessage(key, channel.id, message.id);
  console.log(`Message "${key}" envoyé (aucun message précédent à éditer, id ${message.id}).`);
}

async function sendErrorReportToOwner(summary, discordOwnerId) {
  if (!discordOwnerId) return;
  const errorEmbed = buildErrorReportEmbed(summary);
  if (!errorEmbed) return;
  const owner = await client.users.fetch(discordOwnerId);
  await owner.send({ embeds: [errorEmbed] });
}

async function sendStuckAlertToOwner(history, discordOwnerId, stuckAlertMinDays) {
  if (!discordOwnerId) return;
  const stuckAccounts = detectStuckAccounts(history, stuckAlertMinDays);
  const stuckEmbed = buildStuckAccountsEmbed(stuckAccounts);
  if (!stuckEmbed) return;
  const owner = await client.users.fetch(discordOwnerId);
  await owner.send({ embeds: [stuckEmbed] });
}

client.once('clientReady', async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  if (!acquireLock()) {
    console.error('Une collecte est déjà en cours (cron ou autre scan). Abandon.');
    await client.destroy();
    process.exit(1);
  }

  markScanStarted();
  try {
    const settings = loadSettings();
    const channel = settings.discordChannelId ? await client.channels.fetch(settings.discordChannelId) : null;
    const summary = await buildViewsSummary(loadAccounts(), settings.postsLimit);

    const historyBefore = loadHistory();
    const growth24h = computeGrowth24h(historyBefore, summary);

    const cumulativeBefore = loadCumulativeViews();
    const cumulativeAfter = updateCumulativeViews(cumulativeBefore, growth24h, summary);
    saveCumulativeViews(cumulativeAfter);

    if (channel) {
      const dailyEmbed = build24hEmbed(growth24h, summary, new Date());
      await sendOrEditSummary(channel, 'daily', dailyEmbed);

      const allTimeEmbed = buildAllTimeEmbed(cumulativeAfter, summary, new Date());
      await sendOrEditSummary(channel, 'allTime', allTimeEmbed);
    }

    const historyAfter = appendToday(historyBefore, summary);
    await sendErrorReportToOwner(summary, settings.discordOwnerId);
    await sendStuckAlertToOwner(historyAfter, settings.discordOwnerId, settings.stuckAlertMinDays);
    await sendDataBackupToOwner(client, settings.discordOwnerId);
    markScanFinished();

    console.log('Collecte manuelle terminée.');
  } catch (error) {
    markScanFinished(error.message);
    console.error('Erreur pendant la collecte manuelle :', error);
    process.exitCode = 1;
  } finally {
    releaseLock();
    await client.destroy();
    process.exit(process.exitCode || 0);
  }
});

client.login(config.discordToken);
