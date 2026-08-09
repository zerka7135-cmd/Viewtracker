import { config } from './config.js';
import { buildViewsSummary } from './instagram.js';
import { build24hEmbed, buildAllTimeEmbed, buildErrorReportEmbed, buildStuckAccountsEmbed } from './embed.js';
import { acquireLock, releaseLock } from './cache.js';
import { loadHistory, appendToday, computeGrowth24h, detectStuckAccounts } from './history.js';
import { loadLastMessage, saveLastMessage } from './lastMessage.js';
import { loadCumulativeViews, updateCumulativeViews, saveCumulativeViews } from './cumulativeViews.js';
import { loadAccounts } from './accountsStore.js';
import { loadSettings } from './settingsStore.js';
import { getDefaultOrgId } from './org.js';

// Cycle de collecte partagé par le cron (src/index.js), le déclenchement
// manuel depuis le dashboard (POST /api/scan, voir src/server.js) et le
// lock existant (src/cache.js) empêche déjà les deux de tourner en même
// temps. scripts/run-once.js garde sa propre implémentation console,
// distincte de celle-ci (affichage terminal plutôt que Discord/API).
//
// Mono-tenant pour l'instant : toutes les I/O (accountsStore, history,
// cumulativeViews, lastMessage, settingsStore) sont maintenant en Postgres
// et prennent un orgId — résolu une fois via getDefaultOrgId() (voir
// src/org.js), pas encore par session utilisateur (chantier auth à venir).

let scanning = false;
let lastScanAt = null;
let lastScanError = null;

/** @returns {{scanning: boolean, lastScanAt: string|null, lastScanError: string|null}} */
export function getScanStatus() {
  return { scanning, lastScanAt, lastScanError };
}

// Le réglage "Salons Discord" (settingsStore.discordChannelId) accepte
// plusieurs IDs — un par ligne ou séparés par une virgule (voir
// SettingsView.jsx) — pour poster le même classement dans plusieurs
// salons/serveurs à la fois.
function parseChannelIds(raw) {
  if (!raw) return [];
  return [...new Set(raw.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean))];
}

// Édite le message de la veille au lieu d'en renvoyer un nouveau à chaque
// cycle, pour ne pas empiler un message par jour dans le salon. `key`
// distingue les différents messages suivis (leaderboard du jour, all
// time...) puisqu'ils s'éditent chacun indépendamment. Si l'édition échoue
// (message supprimé manuellement, trop ancien pour Discord, ou premier
// lancement sans message enregistré), on retombe sur un envoi classique et
// on mémorise ce nouveau message pour la prochaine fois.
async function sendOrEditSummary(orgId, channel, key, embed) {
  const last = await loadLastMessage(orgId, key);

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
  await saveLastMessage(orgId, key, channel.id, message.id);
}

// Les échecs de scraping ne vont jamais dans le salon public : seul le
// propriétaire du bot les reçoit en MP, pour garder le résumé quotidien
// propre pour tout le monde d'autre. Gaté par le réglage "Alertes de
// scraping" (settingsStore.notifWarnings, modifiable depuis le dashboard).
async function sendErrorReportToOwner(client, summary, ownerId) {
  if (!ownerId) return;

  const errorEmbed = buildErrorReportEmbed(summary);
  if (!errorEmbed) return;

  try {
    const owner = await client.users.fetch(ownerId);
    await owner.send({ embeds: [errorEmbed] });
  } catch (error) {
    console.error('Erreur lors de l\'envoi du rapport d\'échecs en MP :', error);
  }
}

// Alerte distincte du rapport d'échecs ponctuels ci-dessus : ne se
// déclenche que si un compte/plateforme échoue plusieurs collectes de
// suite (cookie expiré, sélecteur DOM cassé...), signe d'un vrai problème
// à corriger plutôt qu'un raté isolé. Même réglage notifWarnings.
async function sendStuckAlertToOwner(client, history, ownerId) {
  if (!ownerId) return;

  const stuckAccounts = detectStuckAccounts(history, config.stuckAlertMinDays);
  const stuckEmbed = buildStuckAccountsEmbed(stuckAccounts);
  if (!stuckEmbed) return;

  try {
    const owner = await client.users.fetch(ownerId);
    await owner.send({ embeds: [stuckEmbed] });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'alerte comptes bloqués en MP :', error);
  }
}

/**
 * Lance une collecte complète (scraping + historique + cumul) puis, selon
 * les réglages (settingsStore, modifiables depuis le dashboard), diffuse
 * les résultats sur Discord. La persistance en base (historique, cumul) a
 * lieu dans tous les cas, indépendamment des réglages de notification.
 * @param {import('discord.js').Client} client Client Discord connecté
 * @returns {Promise<{summary: Array, sent: boolean}>}
 */
export async function runScanCycle(client) {
  if (!acquireLock()) {
    throw new Error('Une collecte est déjà en cours (cron, scan manuel ou dashboard). Réessayez plus tard.');
  }

  scanning = true;
  lastScanError = null;

  try {
    const orgId = await getDefaultOrgId();
    const settings = await loadSettings(orgId);
    const summary = await buildViewsSummary(await loadAccounts(orgId), settings.postsLimit);

    // L'historique *avant* ajout du jour sert de référence pour le calcul
    // du gain 24h (comparer aujourd'hui à aujourd'hui n'aurait pas de sens).
    const historyBefore = await loadHistory(orgId);
    const growth24h = computeGrowth24h(historyBefore, summary);

    // Cumul "all time", classé indépendamment du leaderboard 24h (voir
    // cumulativeViews.js) — additionne le gain de chaque collecte déjà
    // réalisée, sans jamais repartir de zéro ni recompter le total brut.
    const cumulativeBefore = await loadCumulativeViews(orgId);
    const cumulativeAfter = updateCumulativeViews(cumulativeBefore, growth24h, summary);
    await saveCumulativeViews(orgId, cumulativeAfter);

    const historyAfter = await appendToday(orgId, summary);

    let sent = false;
    const channelIds = settings.notifDaily ? parseChannelIds(settings.discordChannelId) : [];
    if (channelIds.length > 0) {
      const dailyEmbed = build24hEmbed(growth24h, summary, new Date());
      const allTimeEmbed = buildAllTimeEmbed(cumulativeAfter, summary, new Date());

      for (const channelId of channelIds) {
        try {
          const channel = await client.channels.fetch(channelId);
          await sendOrEditSummary(orgId, channel, `daily:${channelId}`, dailyEmbed);
          await sendOrEditSummary(orgId, channel, `allTime:${channelId}`, allTimeEmbed);
          sent = true;
        } catch (error) {
          console.error(`Échec de l'envoi vers le salon Discord ${channelId} :`, error.message);
        }
      }
    }

    if (settings.notifWarnings) {
      await sendErrorReportToOwner(client, summary, settings.discordOwnerId);
      await sendStuckAlertToOwner(client, historyAfter, settings.discordOwnerId);
    }

    lastScanAt = new Date().toISOString();
    return { summary, sent };
  } catch (error) {
    lastScanError = error.message;
    throw error;
  } finally {
    scanning = false;
    releaseLock();
  }
}
