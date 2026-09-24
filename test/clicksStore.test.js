import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Chemin fixé *avant* l'import (résolu au chargement du module), vers un
// dossier temporaire — jamais la vraie base.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-clicks-'));
process.env.CLICKS_DB_PATH = path.join(dir, 'clicks.db');
process.env.HISTORY_PATH = path.join(dir, 'history.json');
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CHANNEL_ID ||= 'test';
process.env.ACCOUNTS ||= '[]';

const store = await import('../src/clicksStore.js');
const { todayKey } = await import('../src/history.js');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const daysAgo = (n) => {
  const [y, m, d] = todayKey().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

test('sans base : rien n\'est créé par une lecture', () => {
  assert.equal(store.hasClicks(), false);
  assert.equal(store.getClickTotals().size, 0);
  assert.equal(fs.existsSync(process.env.CLICKS_DB_PATH), false);
});

test('upsertClicks : renvoyer le même jour remplace, ne cumule pas', () => {
  store.upsertClicks([{ account: 'a', date: daysAgo(0), source: 'x', clicks: 10 }]);
  store.upsertClicks([{ account: 'a', date: daysAgo(0), source: 'x', clicks: 25 }]);
  assert.equal(store.getClickTotals().get('a').allTime, 25);
  assert.equal(store.hasClicks(), true);
});

test('getClickTotals : 7 derniers jours vs depuis toujours, plusieurs sources additionnées', () => {
  store.upsertClicks([
    { account: 'b', date: daysAgo(6), source: 'x', clicks: 1 },   // dans la fenêtre
    { account: 'b', date: daysAgo(7), source: 'x', clicks: 100 }, // juste hors fenêtre
    { account: 'b', date: daysAgo(2), source: 'y', clicks: 4 }
  ]);
  assert.deepEqual(store.getClickTotals().get('b'), { last7d: 5, allTime: 105 });
});

test('getClicksSeries : un point par jour, 0 sans clic, filtre par compte', () => {
  const all = store.getClicksSeries(3);
  assert.deepEqual(all.map(p => p.date), [daysAgo(2), daysAgo(1), daysAgo(0)]);
  assert.deepEqual(all.map(p => p.value), [4, 0, 25]);
  assert.deepEqual(store.getClicksSeries(3, 'a').map(p => p.value), [0, 0, 25]);
});

test('upsertClicks : un champ absent laisse les autres valeurs du jour intactes', () => {
  const d = daysAgo(1);
  store.upsertClicks([{ account: 'e', date: d, source: 'x', clicks: 100, forms: 5, cashCents: 12345 }]);
  store.upsertClicks([{ account: 'e', date: d, source: 'x', clicks: 120 }]); // seulement les clics
  store.upsertClicks([{ account: 'e', date: d, source: 'x', cashCents: 20000 }]); // seulement le cash
  assert.deepEqual(store.getPeriodTotals(d, d).get('e'), { clicks: 120, forms: 5, cashCents: 20000 });
});

test('getPeriodTotals : bornes incluses, sources additionnées, sans borne = tout', () => {
  const t = store.getPeriodTotals(daysAgo(2), daysAgo(1));
  assert.equal(t.get('e').clicks, 120);
  assert.equal(store.getPeriodTotals(daysAgo(0), daysAgo(0)).has('e'), false);
  assert.equal(store.getPeriodTotals().get('e').clicks, 120);
});

test('renameAccountInClicks : les clics suivent le compte renommé', () => {
  store.renameAccountInClicks('b', 'c');
  const totals = store.getClickTotals();
  assert.equal(totals.has('b'), false);
  assert.deepEqual(totals.get('c'), { last7d: 5, allTime: 105 });
});

test('upsertClicks : une ligne invalide annule tout le lot', () => {
  assert.throws(() => store.upsertClicks([
    { account: 'd', date: daysAgo(0), source: 'x', clicks: 9 },
    { account: 'd', date: daysAgo(1), source: 'x', clicks: -1 } // viole CHECK (clicks >= 0)
  ]));
  assert.equal(store.getClickTotals().has('d'), false);
});
