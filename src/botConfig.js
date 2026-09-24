import path from 'path';
import { readJson, writeJsonAtomic } from './jsonStore.js';

// Identifiants du bot Discord (Token/Client ID/Guild ID) modifiables
// depuis le dashboard, en plus de DISCORD_TOKEN/DISCORD_CLIENT_ID/
// DISCORD_GUILD_ID (.env ou variables Railway).
//
// Contrairement à settingsStore.js (salon/destinataire des alertes, qui
// ne fait qu'ajouter un repli si la variable d'env est absente), ici la
// valeur enregistrée doit pouvoir REMPLACER une variable d'env déjà
// définie — sur Railway, DISCORD_TOKEN est une vraie variable de
// plateforme, pas un fichier .env : dotenv ne l'écrase jamais (il ne
// remplit que les clés absentes de process.env), donc un simple ajout
// dans un .env local n'aurait aucun effet en prod. Ce module inverse
// l'ordre de priorité : le fichier local (s'il contient une valeur)
// gagne sur process.env, lu par config.js au démarrage.
//
// ⚠️ Sécurité : le dashboard est protégé par un seul mot de passe partagé
// (voir auth.js), pas un compte par personne — quiconque le connaît peut
// changer le token et prendre le contrôle du bot. Le token n'est jamais
// renvoyé en clair par l'API (voir getBotConfigStatus). Traitez ce mot de
// passe avec le même sérieux que le token lui-même.
export const BOT_CONFIG_PATH = process.env.BOT_CONFIG_PATH || path.resolve('./data/bot-config.json');

function readOverrides() {
  return readJson(BOT_CONFIG_PATH, {}, 'Identifiants du bot') || {};
}

/**
 * Résout les identifiants effectifs : override local en priorité, sinon
 * la variable d'environnement. Appelé par config.js au démarrage.
 * @returns {{discordToken: string|undefined, discordClientId: string|undefined, discordGuildId: string|undefined}}
 */
export function resolveBotIdentity() {
  const overrides = readOverrides();
  return {
    discordToken: overrides.discordToken || process.env.DISCORD_TOKEN,
    discordClientId: overrides.discordClientId || process.env.DISCORD_CLIENT_ID,
    discordGuildId: overrides.discordGuildId || process.env.DISCORD_GUILD_ID
  };
}

function maskToken(token) {
  if (!token || token.length < 8) return null;
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * État actuel pour affichage dans Paramètres — le token n'est jamais
 * renvoyé en clair, seulement un aperçu masqué + s'il est configuré.
 */
export function getBotConfigStatus() {
  const identity = resolveBotIdentity();
  return {
    hasToken: Boolean(identity.discordToken),
    tokenPreview: maskToken(identity.discordToken),
    discordClientId: identity.discordClientId || '',
    discordGuildId: identity.discordGuildId || ''
  };
}

/**
 * @param {Partial<{discordToken: string, discordClientId: string, discordGuildId: string}>} patch
 * Une valeur vide/absente laisse l'override existant inchangé (ne
 * l'efface pas) — permet de ne modifier que le Client ID sans retaper le
 * token à chaque fois, par exemple.
 */
export function updateBotConfig(patch) {
  const current = readOverrides();
  const updated = { ...current };
  for (const key of ['discordToken', 'discordClientId', 'discordGuildId']) {
    if (patch[key]) updated[key] = patch[key];
  }
  writeJsonAtomic(BOT_CONFIG_PATH, updated);
  return getBotConfigStatus();
}
