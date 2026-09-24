import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-views-'));
process.env.HISTORY_PATH = path.join(dir, 'history.json');
process.env.CUMULATIVE_VIEWS_PATH = path.join(dir, 'cumulative.json');
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
let acceptedSecret = 'secret-test';
const server = http.createServer((req, res) => {
  if (req.url !== '/functions/v1/ingest-views' || req.method !== 'POST') { res.writeHead(404); return res.end(); }
  if (req.headers['x-ingest-secret'] !== acceptedSecret) { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const { table, rows } = JSON.parse(body);
    (posts[table] ||= []).push(...rows);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: rows.length }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.VIEWS_INGEST_SECRET = 'secret-test';

const { pushViewsToSupabase, buildDailyViewsRows } = await import('../src/supabaseViews.js');

test('gains quotidiens : un jour par collecte après la première, par plateforme', () => {
  const rows = buildDailyViewsRows(history);
  assert.equal(rows.length, 4);
  const p2 = rows.find((r) => r.account_name === 'Protow' && r.day === '2026-09-02');
  assert.deepEqual({ v: p2.views, ig: p2.views_ig, tt: p2.views_tt, yt: p2.views_yt }, { v: 100, ig: 80, tt: 20, yt: 0 });
  assert.equal(rows.find((r) => r.account_name === 'dj3b04' && r.day === '2026-09-03').views, 5);
});

test('envoi : les deux tables passent par la fonction ingest-views', async () => {
  const result = await pushViewsToSupabase();
  assert.equal(result.ok, true, result.message);
  assert.equal(posts.daily_views.length, 4);
  assert.deepEqual(Object.keys(posts.daily_views[0]).sort(), ['account_name', 'day', 'views', 'views_ig', 'views_tt', 'views_yt']);
  assert.equal(posts.account_views.find((r) => r.account_name === 'Protow').total, 1000);
});

test('secret refusé : échec propre, sans exception', async () => {
  acceptedSecret = 'autre';
  const result = await pushViewsToSupabase();
  assert.equal(result.ok, false);
  assert.match(result.message, /401/);
  server.close();
});
