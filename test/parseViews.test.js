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

test('extractYouTubeViews : scanLimit repère plus de vidéos que postsLimit n\'en suit, sans changer le total', () => {
  const raw = {
    items: [
      { href: '/shorts/AAA', text: '1 k vues' }, { href: '/shorts/BBB', text: '2 k vues' },
      { href: '/shorts/CCC', text: '3 k vues' }, { href: '/shorts/DDD', text: '4 k vues' }
    ],
    spans: []
  };
  const result = extractYouTubeViews(raw, 2, 4);
  assert.equal(result.total, 3000);
  assert.deepEqual(result.scanned.map(c => c.href), ['/shorts/AAA', '/shorts/BBB', '/shorts/CCC', '/shorts/DDD']);
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

test('extractInstagramViews : scanLimit repère plus de publications que postsLimit n\'en suit, sans changer le total', () => {
  const grid = [
    { href: '/x/reel/R1/', text: '1K' }, { href: '/x/reel/R2/', text: '2K' },
    { href: '/x/reel/R3/', text: '3K' }, { href: '/x/reel/R4/', text: '4K' }
  ];
  const result = extractInstagramViews({ grid, playCounts: [], bodyText: '' }, 2, 4);
  assert.equal(result.total, 3000); // inchangé : toujours calculé sur les 2 premières (postsLimit)
  assert.deepEqual(result.counted.map(c => c.href), ['/x/reel/R1/', '/x/reel/R2/']);
  assert.deepEqual(result.scanned.map(c => c.href), ['/x/reel/R1/', '/x/reel/R2/', '/x/reel/R3/', '/x/reel/R4/']);
});

test('extractInstagramViews : replis (play_count/texte) sans ID -> scanned retombe sur counted', () => {
  const result = extractInstagramViews({ grid: [], playCounts: [500, 700, 900], bodyText: '' }, 2, 10);
  assert.deepEqual(result.scanned, result.counted);
});
