import { Client, GatewayIntentBits } from 'discord.js';
import cron from 'node-cron';
import { config, validateConfig } from './config.js';
import { buildViewsSummary } from './instagram.js';
import { build24hEmbed, buildAllTimeEmbed, buildErrorReportEmbed, buildStuckAccountsEmbed, buildDecliningAccountsEmbed } from './embed.js';
import { acquireLock, releaseLock } from './cache.js';
import { loadHistory, appendToday, computeGrowth24h, detectStuckAccounts, detectDecliningAccounts } from './history.js';
import { loadLastMessage, saveLastMessage } from './lastMessage.js';
import { loadCumulativeViews, updateCumulativeViews, saveCumulativeViews } from './cumulativeViews.js';
import { sendDataBackupToOwner } from './backup.js';
import { loadAccounts } from './accountsStore.js';
import { loadSettings } from './settingsStore.js';
import { markScanStarted, markScanFinished } from './scanStatus.js';
import { startServer } from './server.js';
import { syncFromSupabase, isSyncConfigured } from './supabaseSync.js';
import { pushViewsToSupabase, isViewsPushConfigured } from './supabaseViews.js';

validateConfig();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function scrapeAndBroadcast() {
  if (!acquireLock()) {
    console.error('Une collecte est déjà en cours (scan manuel probable). Cycle cron ignoré.');
    return false;
  }

  markScanStarted();
  try {
    // Réglages relus à chaque collecte (pas seulement au démarrage) : un
    // changement fait depuis le dashboard (salon, MP d'alerte, publication
    // activée/désactivée) prend effet dès le prochain cycle, sans
    // redémarrage — voir settingsStore.js.
    const settings = loadSettings();
    const accounts = loadAccounts();
    const summary = await buildViewsSummary(accounts, settings.postsLimit);

    // L'historique *avant* ajout du jour sert de référence pour le calcul
    // du gain 24h (comparer aujourd'hui à aujourd'hui n'aurait pas de sens).
    const historyBefore = loadHistory();
    const growth24h = computeGrowth24h(historyBefore, summary);

    // Cumul "all time", classé indépendamment du leaderboard 24h (voir
    // src/cumulativeViews.js) — additionne le gain de chaque collecte déjà
    // réalisée, sans jamais repartir de zéro ni recompter le total brut.
    const cumulativeBefore = loadCumulativeViews();
    const cumulativeAfter = updateCumulativeViews(cumulativeBefore, growth24h, summary);
    saveCumulativeViews(cumulativeAfter);

    // La publication Discord peut être coupée depuis le dashboard
    // (Paramètres > Discord > "Publier sur Discord") sans arrêter la
    // collecte elle-même — les données restent à jour pour le dashboard
    // même si personne ne veut plus les voir dans un salon.
    if (settings.notifDaily && settings.discordChannelId) {
      const channel = await client.channels.fetch(settings.discordChannelId);

      const dailyEmbed = build24hEmbed(growth24h, summary, new Date());
      await sendOrEditSummary(channel, 'daily', dailyEmbed);

      const allTimeEmbed = buildAllTimeEmbed(cumulativeAfter, summary, new Date());
      await sendOrEditSummary(channel, 'allTime', allTimeEmbed);
    }

    const historyAfter = appendToday(historyBefore, summary);
    await pushViewsToSupabase();
    if (settings.notifWarnings) {
      await sendErrorReportToOwner(summary, settings.discordOwnerId);
      await sendStuckAlertToOwner(historyAfter, settings.discordOwnerId, settings.stuckAlertMinDays);
      await sendDecliningAlertToOwner(historyAfter, settings.discordOwnerId);
      await sendDataBackupToOwner(client, settings.discordOwnerId);
    }
    markScanFinished();
    return true;
  } catch (error) {
    markScanFinished(error.message);
    throw error;
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
async function sendErrorReportToOwner(summary, discordOwnerId) {
  if (!discordOwnerId) return;

  const errorEmbed = buildErrorReportEmbed(summary);
  if (!errorEmbed) return;

  try {
    const owner = await client.users.fetch(discordOwnerId);
    await owner.send({ embeds: [errorEmbed] });
  } catch (error) {
    console.error('Erreur lors de l\'envoi du rapport d\'échecs en MP :', error);
  }
}

// Alerte distincte du rapport d'échecs ponctuels ci-dessus : ne se
// déclenche que si un compte/plateforme échoue plusieurs collectes de
// suite (cookie expiré, sélecteur DOM cassé...), signe d'un vrai problème
// à corriger plutôt qu'un raté isolé.
async function sendStuckAlertToOwner(history, discordOwnerId, stuckAlertMinDays) {
  if (!discordOwnerId) return;

  const stuckAccounts = detectStuckAccounts(history, stuckAlertMinDays);
  const stuckEmbed = buildStuckAccountsEmbed(stuckAccounts);
  if (!stuckEmbed) return;

  try {
    const owner = await client.users.fetch(discordOwnerId);
    await owner.send({ embeds: [stuckEmbed] });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'alerte comptes bloqués en MP :', error);
  }
}

// Alerte distincte de sendStuckAlertToOwner ci-dessus : un vrai déclin
// d'audience (voir detectDecliningAccounts), pas une panne de scraping —
// le compte continue d'être scrapé normalement, il gagne juste beaucoup
// moins de vues qu'à son rythme habituel depuis plusieurs jours.
async function sendDecliningAlertToOwner(history, discordOwnerId) {
  if (!discordOwnerId) return;

  const decliningAccounts = detectDecliningAccounts(history);
  const decliningEmbed = buildDecliningAccountsEmbed(decliningAccounts);
  if (!decliningEmbed) return;

  try {
    const owner = await client.users.fetch(discordOwnerId);
    await owner.send({ embeds: [decliningEmbed] });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'alerte baisse d\'audience en MP :', error);
  }
}

client.on('error', (error) => console.error('Erreur client Discord :', error));
process.on('unhandledRejection', (reason) => console.error('unhandledRejection :', reason));

// Le dashboard reste consultable même si le client Discord est en cours de
// (re)connexion — démarré indépendamment, pas dans clientReady. `client`
// est passé (déjà en cours de connexion, pas forcément prêt) pour que le
// serveur puisse envoyer un MP d'alerte à l'owner en cas de tentatives de
// connexion suspectes au dashboard (voir server.js#sendLoginAlert) —
// discord.js met en file d'attente les envois tant que le client n'est pas
// encore "ready", pas besoin d'attendre clientReady ici.
startServer(client).catch((error) => console.error('Erreur au démarrage du dashboard :', error));

// --- Planification automatique ---
client.once('clientReady', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  // Réglages de collecte relus une fois au démarrage : contrairement à
  // discordChannelId/discordOwnerId/notifDaily/notifWarnings (relus à
  // chaque cycle, voir scrapeAndBroadcast), cronSchedule/timezone ne
  // peuvent prendre effet qu'en ré-enregistrant le job, donc seulement au
  // prochain redémarrage — c'est bien ce que l'UI (SettingsView.jsx)
  // annonce, mais jusqu'ici rien ne lisait réellement ces réglages : la
  // planification restait figée sur config.cronSchedule/config.timezone
  // (.env) quoi qu'on change depuis le dashboard.
  const { cronSchedule, timezone } = loadSettings();

  cron.schedule(
    cronSchedule,
    async () => {
      // Décale le déclenchement réel de 0 à 120 min après l'heure planifiée :
      // une collecte qui démarre à la seconde près, tous les jours depuis la
      // même IP serveur, est un signal d'automatisation facile à repérer.
      const jitterMs = Math.floor(Math.random() * 120 * 60 * 1000);
      console.log(`Déclenchement cron : collecte différée de ${Math.round(jitterMs / 60000)} min.`);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));

      try {
        const sent = await scrapeAndBroadcast();
        if (sent) console.log('Résumé automatique envoyé.');
      } catch (error) {
        console.error('Erreur lors de l\'envoi automatique du résumé :', error);
      }
    },
    { timezone }
  );

  console.log(`Planification active : "${cronSchedule}" (${timezone})`);

  // Rattrape au démarrage les vues pas encore envoyées à l'app Lovable (première mise en place, panne).
  if (isViewsPushConfigured()) pushViewsToSupabase();

  // Synchronisation des clics/cash depuis Supabase : une fois au démarrage
  // (7 jours), puis toutes les SUPABASE_SYNC_MINUTES (10 par défaut) — les
  // clics changent toute la journée, contrairement aux vues (une collecte
  // par jour). Sans SUPABASE_URL/SUPABASE_KEY, rien ne tourne.
  if (isSyncConfigured()) {
    const minutes = Math.max(1, Number(process.env.SUPABASE_SYNC_MINUTES) || 10);
    const run = () => syncFromSupabase({ days: 7 }).then((r) => {
      if (!r.ok) console.error('Synchronisation Supabase en échec :', r.message);
    });
    run();
    setInterval(run, minutes * 60 * 1000);
    console.log(`Synchronisation Supabase active (toutes les ${minutes} min).`);
  }
});

client.login(config.discordToken);
