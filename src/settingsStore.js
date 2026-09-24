import path from 'path';
import { config } from './config.js';
import { readJson, writeJsonAtomic } from './jsonStore.js';

// Réglages modifiables depuis le dashboard (voir server.js), persistés à
// part de la config .env. discordChannelId/discordOwnerId prennent effet
// immédiatement (relus à chaque collecte, voir index.js/run-once.js) ;
// cronSchedule/timezone/postsLimit sont affichés/éditables ici mais ne
// prennent effet qu'au prochain redémarrage du process (cron.schedule() et
// config.postsLimit ne sont lus qu'une fois au démarrage) — annoncé comme
// tel côté UI (SettingsView.jsx).
export const SETTINGS_PATH = process.env.SETTINGS_PATH || path.resolve('./data/settings.json');

export const DEFAULT_COMMISSION_PER_CLICK = 0.18;
// Le cash arrive dans la devise de la source (dollars) : converti en euros à
// l'affichage avec ce coefficient — même valeur que l'app de référence
// (Clipper HQ, `NP = cash × 0.8732`). Réglable ; 1 = aucun changement.
export const DEFAULT_CASH_CONVERSION_RATE = 0.8732;

const DEFAULTS = {
  notifDaily: true, // envoi/édition des embeds dans le salon Discord public
  notifWarnings: true, // MP au propriétaire pour les échecs/comptes bloqués/backup
  discordChannelId: null,
  discordOwnerId: null,
  cronSchedule: null,
  timezone: null,
  postsLimit: null,
  stuckAlertMinDays: null,
  commissionPerClick: null, // € versés au clipper par clic quand il n'a pas de tarif propre
  cashConversionRate: null // cash brut de la source -> €
};

function readStored() {
  return readJson(SETTINGS_PATH, {}, 'Réglages') || {};
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
    stuckAlertMinDays: stored.stuckAlertMinDays || config.stuckAlertMinDays,
    commissionPerClick: Number.isFinite(stored.commissionPerClick) && stored.commissionPerClick >= 0 ? stored.commissionPerClick : DEFAULT_COMMISSION_PER_CLICK,
    cashConversionRate: Number.isFinite(stored.cashConversionRate) && stored.cashConversionRate > 0 ? stored.cashConversionRate : DEFAULT_CASH_CONVERSION_RATE
  };
}

export function updateSettings(patch) {
  const stored = { ...DEFAULTS, ...readStored(), ...patch };
  writeJsonAtomic(SETTINGS_PATH, stored);
  return loadSettings();
}
