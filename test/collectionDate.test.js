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

test('computeGrowth24h : hausse d\'IG_POSTS_LIMIT -> les vidéos révélées par la fenêtre élargie servent de point de départ (gain 0)', () => {
  const post = (id, views) => ({ id, views });
  const history = [
    // Ancienne limite : 2 vidéos suivies.
    { date: '2026-09-25', postsLimit: 2, accounts: [{ account: 'A', ig: null, tt: 300, yt: null, total: 300, errors: [], posts: { tt: [post('v1', 200), post('v2', 100)] } }] }
  ];
  // Nouvelle limite : 4 vidéos. v3/v4 existaient déjà (elles ne sont "nouvelles" que
  // parce que la fenêtre s'est élargie), v1/v2 continuent leur progression normale.
  const summary = [{ account: 'A', ig: null, tt: 900, yt: null, total: 900, errors: [], posts: { tt: [post('v1', 250), post('v2', 130), post('v3', 5000), post('v4', 3000)] } }];

  const result = computeGrowth24h(history, summary, '2026-09-26');
  // v1 +50, v2 +30 ; v3/v4 ignorées (index 2 et 3 >= ancienne limite 2).
  assert.deepEqual(result.get('A'), { total: 80, ig: 0, tt: 80, yt: 0 });
});

test('computeGrowth24h : sans postsLimit enregistré sur la collecte de référence (anciennes données), comportement inchangé', () => {
  const post = (id, views) => ({ id, views });
  const history = [
    { date: '2026-09-25', accounts: [{ account: 'A', ig: null, tt: 300, yt: null, total: 300, errors: [], posts: { tt: [post('v1', 200), post('v2', 100)] } }] }
  ];
  const summary = [{ account: 'A', ig: null, tt: 900, yt: null, total: 900, errors: [], posts: { tt: [post('v1', 250), post('v2', 130), post('v3', 5000)] } }];

  const result = computeGrowth24h(history, summary, '2026-09-26');
  // v3 comptée en entier, comme avant ce correctif (pas de postsLimit connu -> pas de garde-fou).
  assert.deepEqual(result.get('A'), { total: 5080, ig: 0, tt: 5080, yt: 0 });
});
