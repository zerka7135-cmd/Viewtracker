import fs from 'fs';
import path from 'path';
import { config } from './config.js';

// Comptes suivis, gérables depuis le dashboard (voir server.js) — persistés
// dans un fichier JSON sur le volume, pas dans ACCOUNTS (.env) qui ne peut
// pas être modifié à chaud sans redéploiement. ACCOUNTS sert uniquement de
// seed initial, la première fois que ce fichier n'existe pas encore ; au-delà,
// c'est ce fichier qui fait foi, ACCOUNTS n'est plus relu.
export const ACCOUNTS_PATH = process.env.ACCOUNTS_STORE_PATH || path.resolve('./data/accounts.json');

function seedFromEnv() {
  return config.accounts.map(a => ({ name: a.name, urls: [...a.urls], alertThreshold: null, alertedThreshold: null }));
}

/** @returns {Array<{name: string, urls: string[], alertThreshold: number|null, alertedThreshold: number|null}>} */
export function loadAccounts() {
  try {
    if (!fs.existsSync(ACCOUNTS_PATH)) {
      const seeded = seedFromEnv();
      saveAccounts(seeded);
      return seeded;
    }
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8'));
    if (!Array.isArray(parsed)) return seedFromEnv();
    // Comptes enregistrés avant l'ajout des seuils d'alerte (voir plus bas) :
    // pas de migration de fichier nécessaire, juste un repli à null au vol.
    return parsed.map(a => ({ alertThreshold: null, alertedThreshold: null, ...a }));
  } catch (e) {
    console.error('Erreur de lecture des comptes, on repart de ACCOUNTS (.env) :', e.message);
    return seedFromEnv();
  }
}

function saveAccounts(accounts) {
  fs.mkdirSync(path.dirname(ACCOUNTS_PATH), { recursive: true });
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

/**
 * @param {string[]} urls [igUrl, ttUrl, ytUrl] — chaîne vide = plateforme non suivie.
 * @param {number|null} alertThreshold Seuil de vues cumulées (all-time) à partir
 * duquel une alerte Discord part une fois (voir index.js#sendThresholdAlertsToOwner) —
 * null désactive l'alerte pour ce compte.
 */
export function addAccount(name, urls, alertThreshold = null) {
  const accounts = loadAccounts();
  if (accounts.some(a => a.name === name)) {
    throw new Error(`Le compte "${name}" existe déjà`);
  }
  accounts.push({ name, urls, alertThreshold, alertedThreshold: null });
  saveAccounts(accounts);
  return accounts;
}

export function updateAccount(currentName, name, urls, alertThreshold = null) {
  const accounts = loadAccounts();
  const index = accounts.findIndex(a => a.name === currentName);
  if (index === -1) {
    throw new Error(`Compte "${currentName}" introuvable`);
  }
  if (name !== currentName && accounts.some(a => a.name === name)) {
    throw new Error(`Le compte "${name}" existe déjà`);
  }
  const existing = accounts[index];
  // Changer le seuil (y compris le désactiver) remet l'alerte à zéro : sans
  // ça, relever un seuil déjà atteint ne redéclencherait jamais rien tant
  // que alertedThreshold garde l'ancienne valeur.
  const alertedThreshold = existing.alertThreshold === alertThreshold ? existing.alertedThreshold : null;
  accounts[index] = { name, urls, alertThreshold, alertedThreshold };
  saveAccounts(accounts);
  return accounts;
}

/**
 * Marque le seuil courant comme déjà notifié — appelé juste après l'envoi
 * de l'alerte (voir index.js), pour ne jamais la renvoyer tant que le seuil
 * lui-même ne change pas.
 */
export function markThresholdAlerted(name, threshold) {
  const accounts = loadAccounts();
  const index = accounts.findIndex(a => a.name === name);
  if (index === -1) return accounts;
  accounts[index] = { ...accounts[index], alertedThreshold: threshold };
  saveAccounts(accounts);
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
