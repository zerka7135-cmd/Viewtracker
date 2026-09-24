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

// Coefficient de conversion du cash à 1 : les montants de ces tests sont déjà
// des euros. Le test dédié plus bas vérifie le coefficient par défaut.
fs.writeFileSync(process.env.SETTINGS_PATH, JSON.stringify({ cashConversionRate: 1 }));

const { upsertClicks, upsertLinkClicks } = await import('../src/clicksStore.js');
const { getClippersReport, getClipperDetail, getLeaderboard, getDailyMatrix } = await import('../src/clippersData.js');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const DAY = '2026-09-24';
const account = (name, extra = {}) => ({ name, urls: ['', '', ''], ...extra });

fs.writeFileSync(process.env.ACCOUNTS_STORE_PATH, JSON.stringify([
  account('fz.skillz'), account('kaylan0717_08159'), account('art_hur__'),
  account('tarif-special', { rateClick: 0.5 }), account('sans-donnees')
]));
upsertClicks([
  { account: 'fz.skillz', date: DAY, source: 'x', clicks: 1275, forms: 70 },
  { account: 'kaylan0717_08159', date: DAY, source: 'x', clicks: 573, forms: 21, cashCents: 138500 },
  { account: 'art_hur__', date: DAY, source: 'x', clicks: 441, forms: 25 },
  { account: 'tarif-special', date: DAY, source: 'x', clicks: 100, forms: 4 }
]);

test('admin : reproduit les chiffres du tableau de référence, sans les comptes sans clic', () => {
  const { kpis, rows } = getClippersReport({ from: DAY, to: DAY }, { role: 'admin' });

  assert.deepEqual(rows.map((r) => r.name), ['fz.skillz', 'kaylan0717_08159', 'art_hur__', 'tarif-special']);
  const [fz, kaylan] = rows;
  assert.equal(fz.commission, 229.5);
  assert.equal(fz.profit, -229.5);
  assert.equal(+fz.optIn.toFixed(1), 5.5);
  assert.equal(kaylan.commission, 103.14);
  assert.equal(kaylan.cash, 1385);
  assert.equal(+kaylan.eurPerTraffic.toFixed(2), 2.42);
  assert.equal(kaylan.profit, 1281.86);

  // Tarif propre à un clipper : 100 clics × 0,50 € (et non le tarif par défaut).
  assert.equal(rows[3].commission, 50);

  // KPIs : somme des lignes visibles.
  assert.equal(kpis.clicks, 2389);
  assert.equal(kpis.toPay, 229.5 + 103.14 + 79.38 + 50);
  assert.equal(kpis.cash, 1385);
  assert.equal(+kpis.roas.toFixed(2), +(1385 / 462.02).toFixed(2));
});

test('manager : tous les clippers, sans cash, bénéfice ni ROAS', () => {
  const report = getClippersReport({ from: DAY, to: DAY }, { role: 'manager' });

  assert.equal(report.rows.length, 5); // y compris le compte sans donnée
  assert.deepEqual(Object.keys(report.rows[0]).sort(), ['clicks', 'commission', 'eurPerTraffic', 'forms', 'name', 'optIn', 'views']);
  assert.deepEqual(Object.keys(report.kpis).sort(), ['clicks', 'clippers', 'commissions', 'eurPerTraffic', 'optInRate']);
  assert.equal(report.kpis.clippers, 5);
  assert.equal(report.kpis.commissions, 462.02);
  // Rien de financier dans tout ce qui part vers le manager.
  assert.doesNotMatch(JSON.stringify(report), /"(cash|profit|roas|toPay)"/);
});

test('coefficient de conversion du cash (0,8732 par défaut)', () => {
  const settingsBefore = fs.readFileSync(process.env.SETTINGS_PATH, 'utf8');
  try {
    fs.writeFileSync(process.env.SETTINGS_PATH, '{}'); // valeurs par défaut
    const kaylan = getClippersReport({ from: DAY, to: DAY }, { role: 'admin' }).rows.find((r) => r.name === 'kaylan0717_08159');
    assert.equal(kaylan.cash, 1209.38); // 1385 × 0,8732 = 1209,382 arrondi au centime
    assert.equal(kaylan.profit, +(1209.38 - 103.14).toFixed(2));
  } finally {
    fs.writeFileSync(process.env.SETTINGS_PATH, settingsBefore);
  }
});

test('période sans clic : ROAS et opt-in nuls, vues nulles sans collecte', () => {
  const report = getClippersReport({ from: '2020-01-01', to: '2020-01-02' }, { role: 'admin' });
  assert.equal(report.kpis.clicks, 0);
  assert.equal(report.kpis.roas, null);
  assert.equal(report.kpis.optInRate, null);
  assert.deepEqual(report.rows, []);

  const manager = getClippersReport({ from: '2020-01-01', to: '2020-01-02' }, { role: 'manager' });
  assert.ok(manager.rows.every((r) => r.views === null));
});

test('page d\'un clipper : chiffres, courbe avec gains et détail par lien', () => {
  upsertLinkClicks([
    { account: 'fz.skillz', date: DAY, link: 'lien-a', clicks: 1000 },
    { account: 'fz.skillz', date: DAY, link: 'lien-b', clicks: 275 }
  ]);

  const detail = getClipperDetail({ from: '2026-09-22', to: DAY }, 'fz.skillz');
  assert.equal(detail.kpis.clicks, 1275);
  assert.equal(detail.kpis.forms, 70);
  assert.equal(detail.kpis.gains, 229.5);
  assert.equal(detail.ratePerClick, 0.18);
  assert.deepEqual(detail.series.map((p) => p.date), ['2026-09-22', '2026-09-23', DAY]);
  assert.deepEqual(detail.series.map((p) => p.clicks), [0, 0, 1275]);
  assert.equal(detail.series[2].gains, 229.5);
  assert.deepEqual(detail.links, [{ name: 'lien-a', clicks: 1000, gains: 180 }, { name: 'lien-b', clicks: 275, gains: 49.5 }]);

  assert.equal(getClipperDetail({ from: DAY, to: DAY }, 'inconnu'), null);
});

test('leaderboard : classé aux clics, gains visibles seulement pour l\'admin', () => {
  const asClipper = getLeaderboard({ from: DAY, to: DAY }, { role: 'clipper' });
  assert.deepEqual(asClipper.rows.map((r) => r.name), ['fz.skillz', 'kaylan0717_08159', 'art_hur__', 'tarif-special']);
  assert.ok(asClipper.rows.every((r) => !('earnings' in r)));

  const asAdmin = getLeaderboard({ from: DAY, to: DAY }, { role: 'admin' });
  assert.equal(asAdmin.rows[0].earnings, 229.5);
});

test('jour par jour : une colonne par jour, totaux par jour et par clipper', () => {
  const matrix = getDailyMatrix({ from: '2026-09-23', to: DAY });
  assert.deepEqual(matrix.days, ['2026-09-23', DAY]);
  assert.deepEqual(matrix.rows[0], { name: 'fz.skillz', values: [0, 1275], total: 1275 });
  assert.deepEqual(matrix.totals, [0, 2389]);
});
