import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Sur Railway, les variables d'environnement peuvent mettre jusqu'à
// quelques secondes à être injectées dans un container tout juste démarré
// (observé après un redeploy forcé) : sans cette attente, DISCORD_TOKEN
// apparaît manquant au tout premier démarrage alors qu'il est bien configuré,
// ce qui crashait le process avant que Railway ne le redémarre proprement.
async function waitForEnv(varName, maxWaitMs = 8000, intervalMs = 200) {
  const start = Date.now();
  while (!process.env[varName] && Date.now() - start < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

await waitForEnv('DISCORD_TOKEN');
await waitForEnv('DISCORD_CHANNEL_ID');
await waitForEnv('ACCOUNTS');

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordGuildId: process.env.DISCORD_GUILD_ID,
  discordChannelId: process.env.DISCORD_CHANNEL_ID,
  // Optionnel : si renseigné, les échecs de scraping partent en MP à cet
  // utilisateur plutôt que dans le salon public (voir index.js).
  discordOwnerId: process.env.DISCORD_OWNER_ID,
  cronSchedule: process.env.CRON_SCHEDULE || '0 9 * * *',
  timezone: process.env.TIMEZONE || 'Europe/Paris',
  // Nombre de jours en arrière utilisé comme référence pour le % de
  // croissance affiché dans le résumé (voir src/history.js).
  historyLookbackDays: Number(process.env.HISTORY_LOOKBACK_DAYS) || 7,
  // Nombre de collectes consécutives en échec sur un compte/plateforme
  // avant d'alerter le propriétaire (cookie expiré, sélecteur DOM cassé...).
  stuckAlertMinDays: Number(process.env.STUCK_ALERT_MIN_DAYS) || 3,
  // Liste des comptes à suivre, définie en JSON dans le .env (voir .env.example)
  accounts: parseAccounts(process.env.ACCOUNTS)
};

function parseAccounts(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('ACCOUNTS doit être un tableau JSON');
    return parsed;
  } catch (e) {
    throw new Error(`ACCOUNTS est mal formaté dans le .env (JSON invalide) : ${e.message}`);
  }
}

export function validateConfig() {
  if (!config.discordToken) {
    throw new Error('DISCORD_TOKEN est manquant dans le fichier .env');
  }
  if (!config.discordChannelId) {
    throw new Error('DISCORD_CHANNEL_ID est manquant dans le fichier .env (nécessaire pour l\'envoi automatique du résumé)');
  }
  if (!config.accounts || config.accounts.length === 0) {
    throw new Error('Aucun compte défini dans ACCOUNTS dans le fichier .env');
  }
}
