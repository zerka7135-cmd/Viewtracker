import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTikTokEntries } from '../src/tiktok.js';

// Une ligne de sortie `yt-dlp --flat-playlist -j` (seuls les champs utilisés).
const line = (id, view_count, timestamp) => JSON.stringify({ id, view_count, timestamp });

test('parseTikTokEntries : garde les vidéos les plus récentes, plus récente d\'abord', () => {
  const stdout = [line('a', 100, 1000), line('c', 300, 3000), line('b', 200, 2000)].join('\n');

  const videos = parseTikTokEntries(stdout, 2);
  assert.deepEqual(videos.map(v => v.id), ['c', 'b']);
  assert.deepEqual(videos.map(v => v.views), [300, 200]);
});

test('parseTikTokEntries : une vidéo épinglée ancienne (en tête de liste) est écartée', () => {
  // TikTok renvoie les épinglées en premier, quelle que soit leur date.
  const stdout = [
    line('epinglee-ancienne', 900000, 100),
    line('recente-1', 500, 5000),
    line('recente-2', 400, 4000),
    line('recente-3', 300, 3000)
  ].join('\n');

  const videos = parseTikTokEntries(stdout, 2);
  assert.deepEqual(videos.map(v => v.id), ['recente-1', 'recente-2']);
});

test('parseTikTokEntries : ignore les avertissements texte et les lignes JSON tronquées', () => {
  const stdout = [
    'Deprecated Feature: Support for Python version 3.9 has been deprecated.',
    line('a', 10, 1000),
    '{"id": "tronquee", "view_',
    ''
  ].join('\n');

  assert.deepEqual(parseTikTokEntries(stdout, 5).map(v => v.id), ['a']);
});

test('parseTikTokEntries : vues absentes -> 0, id numérique converti en texte', () => {
  const stdout = [
    JSON.stringify({ id: 123456, timestamp: 2000 }),
    JSON.stringify({ id: 'sans-timestamp', view_count: 42 })
  ].join('\n');

  const videos = parseTikTokEntries(stdout, 5);
  assert.equal(videos[0].id, '123456');
  assert.equal(videos[0].views, 0);
  assert.equal(videos[1].views, 42);
});

test('parseTikTokEntries : sortie vide -> aucune vidéo', () => {
  assert.deepEqual(parseTikTokEntries('', 5), []);
  assert.deepEqual(parseTikTokEntries(undefined, 5), []);
});
