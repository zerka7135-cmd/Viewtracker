import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCount, parseViewsText, extractInstagramViews, extractYouTubeViews } from '../src/parseViews.js';

test('parseCount : formats anglais et français de la grille Instagram', () => {
  assert.equal(parseCount('277K'), 277000);
  assert.equal(parseCount('1.2M'), 1200000);
  assert.equal(parseCount('1,2 M'), 1200000);
  assert.equal(parseCount('12,3 k'), 12300);
  assert.equal(parseCount('2,479'), 2479);
  assert.equal(parseCount('1 234'), 1234); // espace fine insécable
  assert.equal(parseCount('850'), 850);
  assert.equal(parseCount('Épinglé'), null);
  assert.equal(parseCount(''), null);
});

test('parseViewsText : "M de vues" (YouTube en français) est reconnu', () => {
  assert.equal(parseViewsText('Mon short\n1,2 M de vues'), 1200000);
  assert.equal(parseViewsText('12 k vues'), 12000);
  assert.equal(parseViewsText('1.2M views'), 1200000);
  assert.equal(parseViewsText('1 234 vues'), 1234);
  assert.equal(parseViewsText('pas de compteur'), 0);
});

test('parseViewsText : un titre finissant par un nombre ne se colle pas au compteur', () => {
  assert.equal(parseViewsText('Top 10 1,2 M de vues'), 1200000);
});

test('extractYouTubeViews : le Short au-delà du million n\'est plus sauté', () => {
  const raw = {
    items: [
      { href: '/shorts/AAA', text: 'Short viral\n1,2 M de vues' },
      { href: '/shorts/BBB', text: 'Short normal\n45 k vues' },
      { href: '/shorts/CCC', text: 'Plus ancien\n3 k vues' }
    ],
    spans: []
  };
  const result = extractYouTubeViews(raw, 2);
  assert.equal(result.total, 1245000);
  assert.deepEqual(result.counted.map(c => c.href), ['/shorts/AAA', '/shorts/BBB']);
});

test('extractInstagramViews : grille en format français, puis replis play_count et texte', () => {
  const grid = extractInstagramViews({
    grid: [{ href: '/x/reel/R1/', text: '1,2 M' }, { href: '/x/reel/R2/', text: '12,3 k' }, { href: '/x/reel/R3/', text: '9K' }],
    playCounts: [], bodyText: ''
  }, 2);
  assert.equal(grid.total, 1212300);

  const playCount = extractInstagramViews({ grid: [], playCounts: [500, 700, 900], bodyText: '' }, 2);
  assert.equal(playCount.total, 1200);

  const text = extractInstagramViews({ grid: [], playCounts: [], bodyText: '10 k vues … 2,5 M de vues … 1 vue' }, 2);
  assert.equal(text.total, 2510000);
});
