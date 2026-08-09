import fs from 'fs';
import path from 'path';

// Permet de renseigner Token/Client ID/Guild ID du bot Discord depuis le
// dashboard (Paramètres > Bot Discord) plutôt que d'éditer le fichier .env
// à la main. Contrairement à discordChannelId/discordOwnerId (voir
// settingsStore.js), ces 3 valeurs pilotent la connexion Discord.js elle-
// même — process.env est déjà figé au moment où l'utilisateur les modifie
// (voir config.js, chargé une seule fois au démarrage), donc on les
// persiste directement dans .env plutôt qu'en base : elles ne prennent
// effet qu'au prochain redémarrage du process (npm start), comme
// documenté côté UI.

const ENV_PATH = path.resolve(process.cwd(), '.env');
const KEYS = {
  discordToken: 'DISCORD_TOKEN',
  discordClientId: 'DISCORD_CLIENT_ID',
  discordGuildId: 'DISCORD_GUILD_ID'
};

function readEnvFile() {
  try {
    return fs.readFileSync(ENV_PATH, 'utf8');
  } catch {
    return '';
  }
}

function maskToken(token) {
  if (!token || token.length < 8) return null;
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * État actuel (pour affichage dans Paramètres) — le token n'est jamais
 * renvoyé en clair, seulement un aperçu masqué + s'il est configuré.
 */
export function getBotConfigStatus() {
  return {
    hasToken: Boolean(process.env.DISCORD_TOKEN),
    tokenPreview: maskToken(process.env.DISCORD_TOKEN),
    discordClientId: process.env.DISCORD_CLIENT_ID || '',
    discordGuildId: process.env.DISCORD_GUILD_ID || ''
  };
}

/**
 * Met à jour une ou plusieurs des 3 valeurs dans .env (remplace la ligne
 * `KEY=...` existante, ou l'ajoute si absente — le reste du fichier, y
 * compris ACCOUNTS et les commentaires, n'est pas touché). Un champ omis
 * ou vide n'écrase pas la valeur existante (permet de ne changer que le
 * Guild ID sans retaper le token, par exemple).
 * @param {{discordToken?: string, discordClientId?: string, discordGuildId?: string}} patch
 */
export function updateBotConfig(patch) {
  let content = readEnvFile();

  for (const [field, envKey] of Object.entries(KEYS)) {
    const value = patch[field];
    if (typeof value !== 'string' || value.trim() === '') continue;
    const trimmed = value.trim();

    const linePattern = new RegExp(`^${envKey}=.*$`, 'm');
    if (linePattern.test(content)) {
      content = content.replace(linePattern, `${envKey}=${trimmed}`);
    } else {
      content = `${content.trimEnd()}\n${envKey}=${trimmed}\n`;
    }

    // process.env reflète immédiatement la nouvelle valeur pour que
    // getBotConfigStatus() renvoie l'état à jour sans relire le fichier —
    // mais le client Discord.js déjà connecté (voir index.js) continue de
    // tourner avec l'ancien token/guild tant que le process n'est pas
    // redémarré (npm start), d'où l'avertissement affiché côté UI.
    process.env[envKey] = trimmed;
  }

  fs.writeFileSync(ENV_PATH, content, 'utf8');
}
