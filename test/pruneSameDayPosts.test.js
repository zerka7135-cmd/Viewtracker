import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Isolé de test/supabaseViews.test.js : vérifie spécifiquement que prune_day
// n'accompagne que les lignes du dernier jour, jamais réparties sur deux
// lots, et jamais les jours passés.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-prune-'));
process.env.HISTORY_PATH = path.join(dir, 'history.json');
process.env.CUMULATIVE_VIEWS_PATH = path.join(dir, 'cumulative.json');
process.env.ACCOUNTS_STORE_PATH = path.join(dir, 'accounts.json');
process.env.PUSH_STATUS_PATH = path.join(dir, 'push-status.json');
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CHANNEL_ID ||= 'test';
process.env.ACCOUNTS ||= '[]';

const post = (id, views) => ({ id, views });
const acc = (name, ttPosts) => ({ account: name, ig: null, tt: ttPosts.reduce((s, p) => s + p.views, 0), yt: null, total: ttPosts.reduce((s, p) => s + p.views, 0), errors: [], posts: { tt: ttPosts } });

const history = [
  { date: '2026-09-29', accounts: [acc('protow', [post('tt1', 100), post('tt2', 200)])] },
  { date: '2026-09-30', collectedAt: '2026-09-30T10:00:00Z', accounts: [acc('protow', [post('tt3', 300), post('tt4', 400)])] }
];
fs.writeFileSync(process.env.HISTORY_PATH, JSON.stringify(history));
fs.writeFileSync(process.env.CUMULATIVE_VIEWS_PATH, JSON.stringify({ protow: { total: 1000, ig: 0, tt: 1000, yt: 0 } }));
fs.writeFileSync(process.env.ACCOUNTS_STORE_PATH, JSON.stringify([{ name: 'protow', urls: ['', 'https://www.tiktok.com/@keo.wxc', ''] }]));

const requestBodies = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    requestBodies.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: JSON.parse(body).rows.length }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.VIEWS_INGEST_SECRET = 'secret-test';

const { pushViewsToSupabase } = await import('../src/supabaseViews.js');

test('prune_day n\'accompagne que les lignes du dernier jour connu, jamais les jours passés', async () => {
  const result = await pushViewsToSupabase();
  assert.equal(result.ok, true, result.message);

  const postViewsCalls = requestBodies.filter((b) => b.table === 'post_views');
  const withPrune = postViewsCalls.filter((b) => b.prune_day);
  const withoutPrune = postViewsCalls.filter((b) => !b.prune_day);

  assert.equal(withPrune.length, 1, 'un seul envoi doit porter prune_day');
  assert.equal(withPrune[0].prune_day, '2026-09-30');
  assert.ok(withPrune[0].rows.every((r) => r.day === '2026-09-30'), 'toutes les lignes de cet envoi doivent être du jour nettoyé');
  assert.deepEqual(withPrune[0].rows.map((r) => r.post_id).sort(), ['tt3', 'tt4']);

  assert.ok(withoutPrune.length >= 1, 'les jours passés partent sans prune_day');
  assert.ok(withoutPrune.every((b) => b.rows.every((r) => r.day !== '2026-09-30')), 'le jour nettoyé ne doit jamais apparaître dans un envoi sans prune_day');
  assert.deepEqual(withoutPrune.flatMap((b) => b.rows.map((r) => r.post_id)).sort(), ['tt1', 'tt2']);
});

test('le dernier jour part en un seul envoi même au-delà de BATCH_SIZE (pas de scission de prune_day)', async () => {
  requestBodies.length = 0;
  const manyPosts = Array.from({ length: 600 }, (_, i) => post('big' + i, i + 1));
  const bigHistory = [
    { date: '2026-10-01', collectedAt: '2026-10-01T10:00:00Z', accounts: [acc('protow', manyPosts)] }
  ];
  fs.writeFileSync(process.env.HISTORY_PATH, JSON.stringify(bigHistory));

  const result = await pushViewsToSupabase();
  assert.equal(result.ok, true, result.message);

  const postViewsCalls = requestBodies.filter((b) => b.table === 'post_views');
  const withPrune = postViewsCalls.filter((b) => b.prune_day);
  assert.equal(withPrune.length, 1);
  assert.equal(withPrune[0].rows.length, 600); // les 600 lignes du jour, en un seul envoi
  assert.ok(postViewsCalls.every((b) => b.rows.length <= 1000));

  server.close();
});
