import fs from 'fs';
import { AttachmentBuilder } from 'discord.js';
import { HISTORY_PATH } from './history.js';
import { CUMULATIVE_PATH } from './cumulativeViews.js';
import { LAST_MESSAGE_PATH } from './lastMessage.js';
import { ACCOUNTS_PATH } from './accountsStore.js';
import { SETTINGS_PATH } from './settingsStore.js';

// Le volume Railway (/data) n'est pas sauvegardé automatiquement par la
// plateforme : une suppression accidentelle du volume, ou un fichier
// corrompu, efface tout d'un coup sans recours (vécu le 09/08 avec le cumul
// all-time, perdu suite à un bug de chemin non persistant). Envoyer une
// copie quotidienne des fichiers de données en MP à l'admin donne un filet
// de secours simple : en cas de pépin, il suffit de retélécharger la pièce
// jointe la plus récente et de la reposer sur le volume via `railway ssh`.
const BACKUP_FILES = [
  { path: HISTORY_PATH, name: 'history.json' },
  { path: CUMULATIVE_PATH, name: 'cumulative-views.json' },
  { path: LAST_MESSAGE_PATH, name: 'last-message.json' },
  { path: ACCOUNTS_PATH, name: 'accounts.json' },
  { path: SETTINGS_PATH, name: 'settings.json' }
];

/**
 * Envoie les fichiers de données courants en pièces jointes au propriétaire
 * du bot. N'échoue jamais bruyamment : un souci ici ne doit pas faire
 * planter le reste de la collecte (log en console et on continue).
 * @param {import('discord.js').Client} client
 * @param {string} discordOwnerId
 */
export async function sendDataBackupToOwner(client, discordOwnerId) {
  if (!discordOwnerId) return;

  const attachments = BACKUP_FILES
    .filter(f => fs.existsSync(f.path))
    .map(f => new AttachmentBuilder(f.path, { name: f.name }));

  if (attachments.length === 0) return;

  try {
    const owner = await client.users.fetch(discordOwnerId);
    await owner.send({
      content: `💾 Sauvegarde des données du ${new Date().toLocaleDateString('fr-FR')}`,
      files: attachments
    });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la sauvegarde en MP :', error);
  }
}
