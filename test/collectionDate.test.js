import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CHANNEL_ID ||= 'test';
process.env.ACCOUNTS ||= '[]';

const { computeGrowth24h, previousDayKey } = await import('../src/history.js');
const { updateCumulativeViews } = await import('../src/cumulativeViews.js');

const snap = (tt) => ({ account: 'A', ig: null, tt, yt: null, total: tt, errors: [], posts: null });
const gain = (tt) => new Map([['A', { total: tt, ig: 0, tt, yt: 0 }]]);

test('previousDayKey : veille, y compris changement de mois et d\'année', () => {
  assert.equal(previousDayKey('2026-09-26'), '2026-09-25');
  assert.equal(previousDayKey('2026-09-01'), '2026-08-31');
  assert.equal(previousDayKey('2026-01-01'), '2025-12-31');
});

test('computeGrowth24h : une collecte déjà enregistrée à la même date ne sert pas de référence', () => {
  const history = [
    { date: '2026-09-25', accounts: [snap(1000)] },
    { date: '2026-09-26', accounts: [snap(1500)] } // première collecte du 26, qui va être remplacée
  ];
  const growth = computeGrowth24h(history, [snap(1800)], '2026-09-26');
  assert.equal(growth.get('A').total, 800); // depuis le 25, pas depuis la collecte remplacée
});

test('cumul : une deuxième collecte le même jour remplace la contribution de la première', () => {
  let cumul = { A: { total: 10000, ig: 0, tt: 10000, yt: 0, lastUpdated: '2026-09-25', dayGain: { total: 0, ig: 0, tt: 0, yt: 0 } } };
  cumul = updateCumulativeViews(cumul, gain(500), [snap(1500)], '2026-09-26');
  assert.equal(cumul.A.total, 10500);
  cumul = updateCumulativeViews(cumul, gain(800), [snap(1800)], '2026-09-26');
  assert.equal(cumul.A.total, 10800);
  assert.equal(cumul.A.tt, 10800);
  assert.deepEqual(cumul.A.dayGain, { total: 800, ig: 0, tt: 800, yt: 0 });
  cumul = updateCumulativeViews(cumul, gain(300), [snap(2100)], '2026-09-27');
  assert.equal(cumul.A.total, 11100);
});

test('cumul : premier jour de suivi rejoué -> le point de départ est le dernier relevé', () => {
  let cumul = updateCumulativeViews({}, new Map(), [snap(1500)], '2026-09-26');
  assert.equal(cumul.A.total, 1500);
  cumul = updateCumulativeViews(cumul, new Map(), [snap(1800)], '2026-09-26');
  assert.equal(cumul.A.total, 1800);
  cumul = updateCumulativeViews(cumul, gain(200), [snap(2000)], '2026-09-27');
  assert.equal(cumul.A.total, 2000);
  assert.equal(cumul.A.dayGainIsStart, undefined);
});

test('cumul : ancien format (sans dayGain) déjà compté ce jour -> ignoré comme avant', () => {
  const cumul = { A: { total: 10000, ig: 0, tt: 10000, yt: 0, lastUpdated: '2026-09-26' } };
  assert.equal(updateCumulativeViews(cumul, gain(800), [snap(1800)], '2026-09-26').A.total, 10000);
});
