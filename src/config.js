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
  discordChannelId: process.env.DISCORD_CHANNEL_ID,
  // Optionnel : si renseigné, les échecs de scraping partent en MP à cet
  // utilisateur plutôt que dans le salon public (voir index.js).
  discordOwnerId: process.env.DISCORD_OWNER_ID,
  cronSchedule: process.env.CRON_SCHEDULE || '0 9 * * *',
  timezone: process.env.TIMEZONE || 'Europe/Paris',
  // Nombre de publications les plus récentes prises en compte pour le total
  // de vues, sur les 3 plateformes (IG/TikTok/YouTube).
  postsLimit: Number(process.env.IG_POSTS_LIMIT) || 5,
  // Nombre de collectes consécutives en échec sur un compte/plateforme
  // avant d'alerter le propriétaire (cookie expiré, sélecteur DOM cassé...).
  stuckAlertMinDays: Number(process.env.STUCK_ALERT_MIN_DAYS) || 3,
  // Liste des comptes à suivre, définie en JSON dans le .env (voir .env.example)
  accounts: parseAccounts(process.env.ACCOUNTS),
  // URL du microservice Python/Scrapling qui scrape IG/YT (voir
  // scraper-service/ et src/scraperClient.js) — http://localhost:8000 en
  // dev, réseau privé Railway en production.
  scraperServiceUrl: process.env.SCRAPER_SERVICE_URL || 'http://localhost:8000',
  // Port du serveur HTTP du dashboard web (voir src/server.js).
  port: Number(process.env.PORT) || 3000,
  // Base Postgres partagée (creator_leaderboard en local, voir README
  // section Postgres) — src/db.js, src/org.js.
  databaseUrl: process.env.DATABASE_URL,
  // Envoi d'email (mot de passe oublié, voir src/email.js) via l'API
  // Resend. resendFrom doit être une adresse d'un domaine vérifié dans
  // Resend en production ; "onboarding@resend.dev" fonctionne sans
  // vérification pour tester.
  resendApiKey: process.env.RESEND_API_KEY,
  resendFrom: process.env.RESEND_FROM || 'onboarding@resend.dev',
  // URL publique du dashboard, utilisée pour construire le lien de
  // réinitialisation de mot de passe dans l'email envoyé.
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT) || 3000}`
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
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL est manquant dans le fichier .env (connexion à la base Postgres)');
  }
}
