import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-views-'));
process.env.HISTORY_PATH = path.join(dir, 'history.json');
process.env.CUMULATIVE_VIEWS_PATH = path.join(dir, 'cumulative.json');
process.env.SYNC_STATUS_PATH = path.join(dir, 'sync-status.json');
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CHANNEL_ID ||= 'test';
process.env.ACCOUNTS ||= '[]';

const acc = (account, ig, tt, yt) => ({ account, ig, tt, yt, total: (ig || 0) + (tt || 0) + (yt || 0), errors: [], posts: null });
const history = [
  { date: '2026-09-01', accounts: [acc('Protow', 100, 50, null), acc('dj3b04', 10, 0, 0)] },
  { date: '2026-09-02', accounts: [acc('Protow', 180, 70, null), acc('dj3b04', 15, 0, 0)] },
  { date: '2026-09-03', accounts: [acc('Protow', 200, 90, null), acc('dj3b04', 15, 5, 0)] }
];
fs.writeFileSync(process.env.HISTORY_PATH, JSON.stringify(history));
fs.writeFileSync(process.env.CUMULATIVE_VIEWS_PATH, JSON.stringify({
  Protow: { total: 1000, ig: 700, tt: 300, yt: 0 },
  dj3b04: { total: 20, ig: 15, tt: 5, yt: 0 }
}));

const posts = {};
let acceptedKey = 'cle-test';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  if (req.headers.apikey !== acceptedKey) { res.writeHead(401); return res.end('{"message":"Invalid API key"}'); }
  if (req.method === 'GET' && table === 'clippers') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify([{ id: 'uuid-protow', discord_name: 'protow' }]));
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    (posts[table] ||= []).push({ onConflict: url.searchParams.get('on_conflict'), prefer: req.headers.prefer, rows: JSON.parse(body) });
    res.writeHead(201);
    res.end();
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_KEY = 'cle-test';

const { pushViewsToSupabase, buildDailyViewsRows } = await import('../src/supabaseViews.js');

test('gains quotidiens : un jour par collecte après la première, par plateforme', () => {
  const rows = buildDailyViewsRows(history);
  assert.equal(rows.length, 4);
  const p2 = rows.find((r) => r.account_name === 'Protow' && r.day === '2026-09-02');
  assert.deepEqual({ v: p2.views, ig: p2.views_ig, tt: p2.views_tt, yt: p2.views_yt }, { v: 100, ig: 80, tt: 20, yt: 0 });
  assert.equal(rows.find((r) => r.account_name === 'dj3b04' && r.day === '2026-09-03').views, 5);
});

test('envoi : upsert des deux tables, clipper relié par le nom (sans la casse)', async () => {
  const result = await pushViewsToSupabase();
  assert.equal(result.ok, true, result.message);

  const daily = posts.daily_views[0];
  assert.equal(daily.onConflict, 'account_name,day');
  assert.match(daily.prefer, /resolution=merge-duplicates/);
  assert.equal(daily.rows.length, 4);
  assert.ok(daily.rows.filter((r) => r.account_name === 'Protow').every((r) => r.clipper_id === 'uuid-protow'));
  assert.ok(daily.rows.filter((r) => r.account_name === 'dj3b04').every((r) => r.clipper_id === null));

  const totals = posts.account_views[0];
  assert.equal(totals.onConflict, 'account_name');
  assert.deepEqual(totals.rows.find((r) => r.account_name === 'Protow').total, 1000);
});

test('clé refusée : échec propre, sans exception', async () => {
  acceptedKey = 'autre';
  const result = await pushViewsToSupabase();
  assert.equal(result.ok, false);
  assert.match(result.message, /401/);
  acceptedKey = 'cle-test';
  server.close();
});
