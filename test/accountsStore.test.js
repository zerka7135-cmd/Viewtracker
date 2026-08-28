import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ACCOUNTS_STORE_PATH est résolu une seule fois au chargement du module —
// fixé avant l'import vers un fichier temporaire dédié, jamais data/accounts.json.
const tmpPath = path.join(os.tmpdir(), `vt-accounts-test-${process.pid}-${Date.now()}.json`);
process.env.ACCOUNTS_STORE_PATH = tmpPath;
// buildAccountsStore lit config.js (ACCOUNTS) au chargement, en repli
// seulement si le fichier n'existe pas encore — donne un tableau vide ici,
// sans dépendre du vrai .env local.
process.env.ACCOUNTS = '[]';

const { loadAccounts, addAccount, updateAccount, markThresholdAlerted } = await import('../src/accountsStore.js');

test.after(() => {
  fs.rmSync(tmpPath, { force: true });
});

test('addAccount : alertThreshold par défaut à null si non fourni', () => {
  addAccount('compteA', ['', '', '']);
  const [account] = loadAccounts();
  assert.equal(account.alertThreshold, null);
  assert.equal(account.alertedThreshold, null);
});

test('updateAccount : changer le seuil remet alertedThreshold à zéro', () => {
  updateAccount('compteA', 'compteA', ['', '', ''], 1000);
  markThresholdAlerted('compteA', 1000);
  let [account] = loadAccounts();
  assert.equal(account.alertThreshold, 1000);
  assert.equal(account.alertedThreshold, 1000);

  // Relever le seuil -> déjà notifié pour l'ancien, doit pouvoir renotifier
  // pour le nouveau (alertedThreshold repart à null).
  updateAccount('compteA', 'compteA', ['', '', ''], 5000);
  [account] = loadAccounts();
  assert.equal(account.alertThreshold, 5000);
  assert.equal(account.alertedThreshold, null);
});

test('updateAccount : re-soumettre le même seuil ne réinitialise pas alertedThreshold', () => {
  markThresholdAlerted('compteA', 5000);
  updateAccount('compteA', 'compteA', ['', '', ''], 5000);
  const [account] = loadAccounts();
  assert.equal(account.alertedThreshold, 5000); // toujours marqué, pas de nouvelle alerte à prévoir
});

test('updateAccount : désactiver le seuil (null) remet aussi alertedThreshold à zéro', () => {
  updateAccount('compteA', 'compteA', ['', '', ''], null);
  const [account] = loadAccounts();
  assert.equal(account.alertThreshold, null);
  assert.equal(account.alertedThreshold, null);
});

test('markThresholdAlerted : compte inexistant -> ignoré sans throw', () => {
  assert.doesNotThrow(() => markThresholdAlerted('inconnu', 100));
});
