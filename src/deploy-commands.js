import { REST, Routes } from 'discord.js';
import 'dotenv/config';
import { resumeCommand } from './commands.js';

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error(
    'DISCORD_TOKEN et DISCORD_CLIENT_ID sont requis dans le .env pour déployer les commandes.'
  );
  process.exit(1);
}

const commands = [resumeCommand.toJSON()];
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

try {
  if (DISCORD_GUILD_ID) {
    // Déploiement sur un seul serveur : la commande apparaît instantanément.
    // Idéal en développement/test.
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log('Commande /resume déployée sur le serveur configuré (instantané).');
  } else {
    // Déploiement global : peut prendre jusqu'à 1h pour apparaître sur Discord.
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
      body: commands,
    });
    console.log('Commande /resume déployée globalement (jusqu\'à 1h pour apparaître).');
  }
} catch (err) {
  console.error('Erreur lors du déploiement de la commande :', err);
}
