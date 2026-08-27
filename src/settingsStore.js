import fs from 'fs';
import path from 'path';
import { config } from './config.js';

// Réglages modifiables depuis le dashboard (voir server.js), persistés à
// part de la config .env. discordChannelId/discordOwnerId prennent effet
// immédiatement (relus à chaque collecte, voir index.js/run-once.js) ;
// cronSchedule/timezone/postsLimit sont affichés/éditables ici mais ne
// prennent effet qu'au prochain redémarrage du process (cron.schedule() et
// config.postsLimit ne sont lus qu'une fois au démarrage) — annoncé comme
// tel côté UI (SettingsView.jsx).
export const SETTINGS_PATH = process.env.SETTINGS_PATH || path.resolve('./data/settings.json');

const DEFAULTS = {
  notifDaily: true, // envoi/édition des embeds dans le salon Discord public
  notifWarnings: true, // MP au propriétaire pour les échecs/comptes bloqués/backup
  discordChannelId: null,
  discordOwnerId: null,
  cronSchedule: null,
  timezone: null,
  postsLimit: null,
  stuckAlertMinDays: null
};

function readStored() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) || {};
  } catch (e) {
    console.error('Erreur de lecture des réglages, on repart des défauts :', e.message);
    return {};
  }
}

/**
 * @returns {{notifDaily: boolean, notifWarnings: boolean, discordChannelId: string, discordOwnerId: string, cronSchedule: string, timezone: string, postsLimit: number}}
 */
export function loadSettings() {
  const stored = { ...DEFAULTS, ...readStored() };
  return {
    notifDaily: stored.notifDaily,
    notifWarnings: stored.notifWarnings,
    discordChannelId: stored.discordChannelId || config.discordChannelId,
    discordOwnerId: stored.discordOwnerId || config.discordOwnerId,
    cronSchedule: stored.cronSchedule || config.cronSchedule,
    timezone: stored.timezone || config.timezone,
    postsLimit: stored.postsLimit || config.postsLimit,
    stuckAlertMinDays: stored.stuckAlertMinDays || config.stuckAlertMinDays
  };
}

export function updateSettings(patch) {
  const stored = { ...DEFAULTS, ...readStored(), ...patch };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(stored, null, 2));
  return loadSettings();
}
