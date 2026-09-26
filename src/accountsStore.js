import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { readJson, writeJsonAtomic } from './jsonStore.js';
import { acquireLock, releaseLock } from './cache.js';
import { renameAccountInHistory } from './history.js';
import { renameAccountInCumulative } from './cumulativeViews.js';
import { renameAccountInClicks } from './clicksStore.js';

// Comptes suivis, gérables depuis le dashboard (voir server.js) — persistés
// dans un fichier JSON sur le volume, pas dans ACCOUNTS (.env) qui ne peut
// pas être modifié à chaud sans redéploiement. ACCOUNTS sert uniquement de
// seed initial, la première fois que ce fichier n'existe pas encore ; au-delà,
// c'est ce fichier qui fait foi, ACCOUNTS n'est plus relu.
export const ACCOUNTS_PATH = process.env.ACCOUNTS_STORE_PATH || path.resolve('./data/accounts.json');

function seedFromEnv() {
  return config.accounts.map(a => ({ name: a.name, urls: [...a.urls] }));
}

/** @returns {Array<{name: string, urls: string[]}>} */
export function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    const seeded = seedFromEnv();
    saveAccounts(seeded);
    return seeded;
  }
  const parsed = readJson(ACCOUNTS_PATH, null, 'Comptes suivis');
  return Array.isArray(parsed) ? parsed : seedFromEnv();
}

function saveAccounts(accounts) {
  writeJsonAtomic(ACCOUNTS_PATH, accounts);
}

/**
 * Tarif par clic (€) d'un compte : le sien s'il en a un, sinon `undefined`
 * (le tarif par défaut des réglages s'applique, voir clippersData.js).
 */
function normalizeRate(rateClick) {
  if (rateClick === undefined || rateClick === null || rateClick === '') return undefined;
  const value = Number(rateClick);
  if (!Number.isFinite(value) || value < 0 || value > 1000) throw new Error('Tarif par clic invalide');
  return value;
}

/**
 * @param {string[]} urls [igUrl, ttUrl, ytUrl] — chaîne vide = plateforme non suivie.
 * @param {{rateClick?: number}} [extra] tarif par clic propre au compte (€), facultatif
 */
export function addAccount(name, urls, { rateClick } = {}) {
  const accounts = loadAccounts();
  if (accounts.some(a => a.name === name)) {
    throw new Error(`Le compte "${name}" existe déjà`);
  }
  const rate = normalizeRate(rateClick);
  accounts.push(rate === undefined ? { name, urls } : { name, urls, rateClick: rate });
  saveAccounts(accounts);
  return accounts;
}

/** Fixe (ou efface avec `null`) le tarif par clic propre à un compte. */
export function setAccountRate(name, rateClick) {
  const accounts = loadAccounts();
  const account = accounts.find(a => a.name === name);
  if (!account) throw new Error(`Compte "${name}" introuvable`);
  const rate = normalizeRate(rateClick);
  if (rate === undefined) delete account.rateClick;
  else account.rateClick = rate;
  saveAccounts(accounts);
  return accounts;
}

export function updateAccount(currentName, name, urls) {
  const accounts = loadAccounts();
  const index = accounts.findIndex(a => a.name === currentName);
  if (index === -1) {
    throw new Error(`Compte "${currentName}" introuvable`);
  }
  if (name !== currentName && accounts.some(a => a.name === name)) {
    throw new Error(`Le compte "${name}" existe déjà`);
  }
  if (name === currentName) {
    accounts[index] = { ...accounts[index], name, urls };
    saveAccounts(accounts);
    return accounts;
  }

  // Renommage : l'historique et le cumul sont rangés par nom, on les migre
  // avec le compte. Le verrou de collecte empêche un scan en cours (qui a
  // déjà chargé l'historique en mémoire) de réécrire l'ancien nom par-dessus
  // juste après la migration.
  if (!acquireLock()) {
    throw new Error('Collecte en cours : réessaie le renommage dans quelques minutes');
  }
  try {
    renameAccountInHistory(currentName, name);
    renameAccountInCumulative(currentName, name);
    renameAccountInClicks(currentName, name);
    accounts[index] = { ...accounts[index], name, urls };
    saveAccounts(accounts);
  } finally {
    releaseLock();
  }
  return accounts;
}

export function deleteAccount(name) {
  const accounts = loadAccounts();
  const filtered = accounts.filter(a => a.name !== name);
  if (filtered.length === accounts.length) {
    throw new Error(`Compte "${name}" introuvable`);
  }
  saveAccounts(filtered);
  return filtered;
}

/** Relie un compte suivi au clipper de l'app Lovable (identifiant stable, voir accountsSync.js). */
export function setAccountClipperId(name, clipperId) {
  const accounts = loadAccounts();
  const account = accounts.find(a => a.name === name);
  if (!account) throw new Error(`Compte "${name}" introuvable`);
  account.clipperId = clipperId;
  saveAccounts(accounts);
  return accounts;
}
