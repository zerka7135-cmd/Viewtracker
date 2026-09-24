import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { readJson, writeJsonAtomic } from './jsonStore.js';
import { acquireLock, releaseLock } from './cache.js';
import { renameAccountInHistory } from './history.js';
import { renameAccountInCumulative } from './cumulativeViews.js';

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

/** @param {string[]} urls [igUrl, ttUrl, ytUrl] — chaîne vide = plateforme non suivie. */
export function addAccount(name, urls) {
  const accounts = loadAccounts();
  if (accounts.some(a => a.name === name)) {
    throw new Error(`Le compte "${name}" existe déjà`);
  }
  accounts.push({ name, urls });
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
    accounts[index] = { name, urls };
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
    accounts[index] = { name, urls };
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
