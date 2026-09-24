import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-clippers-'));
process.env.CLICKS_DB_PATH = path.join(dir, 'clicks.db');
process.env.HISTORY_PATH = path.join(dir, 'history.json');
process.env.ACCOUNTS_STORE_PATH = path.join(dir, 'accounts.json');
process.env.SETTINGS_PATH = path.join(dir, 'settings.json');
process.env.CUMULATIVE_VIEWS_PATH = path.join(dir, 'cumulative.json');
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CHANNEL_ID ||= 'test';
process.env.ACCOUNTS ||= '[]';

const { upsertClicks } = await import('../src/clicksStore.js');
const { getClippersReport } = await import('../src/clippersData.js');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const DAY = '2026-09-24';
const account = (name) => ({ name, urls: ['', '', ''] });

test('rapport Clippers : reproduit les chiffres du tableau de bord de référence', () => {
  fs.writeFileSync(process.env.ACCOUNTS_STORE_PATH, JSON.stringify([
    account('fz.skillz'), account('kaylan0717_08159'), account('art_hur__'), account('sans-donnees')
  ]));
  upsertClicks([
    { account: 'fz.skillz', date: DAY, source: 'x', clicks: 1275, forms: 70 },
    { account: 'kaylan0717_08159', date: DAY, source: 'x', clicks: 573, forms: 21, cashCents: 138500 },
    { account: 'art_hur__', date: DAY, source: 'x', clicks: 441, forms: 25 }
  ]);

  const { kpis, rows, commissionPerClick } = getClippersReport({ from: DAY, to: DAY });
  assert.equal(commissionPerClick, 0.18);

  // Lignes : classées par clics décroissants.
  assert.deepEqual(rows.map(r => r.name), ['fz.skillz', 'kaylan0717_08159', 'art_hur__', 'sans-donnees']);
  const [fz, kaylan] = rows;
  assert.equal(fz.commission, 229.5);
  assert.equal(fz.profit, -229.5);
  assert.equal(+fz.optIn.toFixed(1), 5.5);
  assert.equal(kaylan.commission, 103.14);
  assert.equal(kaylan.cash, 1385);
  assert.equal(+kaylan.eurPerTraffic.toFixed(2), 2.42);
  assert.equal(kaylan.profit, 1281.86);

  // Compte sans donnée : zéros, pas de division par zéro.
  const empty = rows[3];
  assert.deepEqual([empty.clicks, empty.forms, empty.optIn, empty.eurPerTraffic, empty.commission, empty.profit], [0, 0, null, 0, 0, 0]);

  // KPIs : la somme des lignes retombe sur le total.
  assert.equal(kpis.clicks, 2289);
  assert.equal(kpis.toPay, 412.02);
  assert.equal(kpis.cash, 1385);
  assert.equal(kpis.profit, 972.98);
  assert.equal(+kpis.roas.toFixed(2), 3.36);
  assert.equal(+kpis.optInRate.toFixed(1), 5.1);
});

test('rapport Clippers : vues null sans collecte dans la période, période sans clic -> ROAS null', () => {
  const report = getClippersReport({ from: '2020-01-01', to: '2020-01-02' });
  assert.equal(report.kpis.clicks, 0);
  assert.equal(report.kpis.roas, null);
  assert.equal(report.kpis.optInRate, null);
  assert.ok(report.rows.every(r => r.views === null));
});
