import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Chemins de données fixés *avant* l'import (résolus au chargement des
// modules), vers un dossier temporaire — jamais les vraies données.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-rename-'));
process.env.HISTORY_PATH = path.join(dir, 'history.json');
process.env.CUMULATIVE_VIEWS_PATH = path.join(dir, 'cumulative-views.json');
process.env.ACCOUNTS_STORE_PATH = path.join(dir, 'accounts.json');
process.env.LOCK_PATH = path.join(dir, '.scrape.lock');
process.env.CLICKS_DB_PATH = path.join(dir, 'clicks.db');
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CHANNEL_ID ||= 'test';
process.env.ACCOUNTS ||= '[]';

const { updateAccount } = await import('../src/accountsStore.js');
const { loadHistory } = await import('../src/history.js');
const { loadCumulativeViews } = await import('../src/cumulativeViews.js');
const { acquireLock, releaseLock } = await import('../src/cache.js');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function seed() {
  fs.writeFileSync(process.env.ACCOUNTS_STORE_PATH, JSON.stringify([{ name: 'ancien', urls: ['', '', ''] }, { name: 'autre', urls: ['', '', ''] }]));
  fs.writeFileSync(process.env.HISTORY_PATH, JSON.stringify([
    { date: '2026-09-01', accounts: [{ account: 'ancien', ig: 10 }, { account: 'autre', ig: 5 }] },
    { date: '2026-09-02', accounts: [{ account: 'ancien', ig: 20 }, { account: 'autre', ig: 6 }] }
  ]));
  fs.writeFileSync(process.env.CUMULATIVE_VIEWS_PATH, JSON.stringify({
    ancien: { total: 999, ig: 999, tt: 0, yt: 0, lastUpdated: '2026-09-02' },
    autre: { total: 1, ig: 1, tt: 0, yt: 0, lastUpdated: '2026-09-02' }
  }));
}

test('updateAccount : renommer un compte migre son historique et son cumul', () => {
  seed();
  updateAccount('ancien', 'nouveau', ['', '', '']);

  const history = loadHistory();
  assert.deepEqual(history.map(h => h.accounts.map(a => a.account)), [['nouveau', 'autre'], ['nouveau', 'autre']]);

  const cumulative = loadCumulativeViews();
  assert.equal(cumulative.nouveau.total, 999);
  assert.equal('ancien' in cumulative, false);
  assert.equal(cumulative.autre.total, 1);
});

test('updateAccount : renommage refusé pendant une collecte, rien n\'est modifié', () => {
  seed();
  assert.equal(acquireLock(), true);
  try {
    assert.throws(() => updateAccount('ancien', 'nouveau', ['', '', '']), /Collecte en cours/);
  } finally {
    releaseLock();
  }
  assert.equal(loadHistory()[0].accounts[0].account, 'ancien');
  assert.equal('ancien' in loadCumulativeViews(), true);
});

test('updateAccount : modifier seulement les URLs ne demande pas le verrou', () => {
  seed();
  assert.equal(acquireLock(), true);
  try {
    updateAccount('ancien', 'ancien', ['https://www.instagram.com/x/', '', '']);
  } finally {
    releaseLock();
  }
});
