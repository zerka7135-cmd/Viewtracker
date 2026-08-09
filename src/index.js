import { Client, GatewayIntentBits } from 'discord.js';
import { config, validateConfig } from './config.js';
import { runMigrations } from './db.js';
import { startServer } from './server.js';
import { startScheduler } from './scheduler.js';

validateConfig();

// Applique les migrations additives de ce bot sur la base Postgres
// partagée (voir migrations/, README section Postgres) avant toute autre
// I/O — les tables/colonnes propres à ViewTracker doivent exister avant
// que accountsStore/history/etc. n'y touchent.
await runMigrations();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on('error', (error) => console.error('Erreur client Discord :', error));
process.on('unhandledRejection', (reason) => console.error('unhandledRejection :', reason));

// --- Dashboard web (voir src/server.js) ---
// Démarré indépendamment de l'état du client Discord : le dashboard reste
// consultable même si le bot est en cours de reconnexion. Le dashboard ne
// déclenche plus de scan (retiré à la demande) : la collecte reste
// pilotée uniquement par le cron planifié (voir src/scheduler.js).
await startServer();

// --- Planification automatique (voir src/scheduler.js) ---
client.once('clientReady', async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  await startScheduler(client);
});

client.login(config.discordToken);
