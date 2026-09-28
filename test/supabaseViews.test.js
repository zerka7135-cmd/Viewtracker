import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-views-'));
process.env.HISTORY_PATH = path.join(dir, 'history.json');
process.env.CUMULATIVE_VIEWS_PATH = path.join(dir, 'cumulative.json');
process.env.ACCOUNTS_STORE_PATH = path.join(dir, 'accounts.json');
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
  assert.equal(posts.account_views[0].updated_at, fs.statSync(process.env.HISTORY_PATH).mtime.toISOString());
});

test('secret refusé : échec propre, sans exception', async () => {
  acceptedSecret = 'autre';
  const result = await pushViewsToSupabase();
  assert.equal(result.ok, false);
  assert.match(result.message, /401/);
});

test('VIEWS_INGEST_URL prioritaire sur la fonction Supabase', async () => {
  acceptedSecret = 'secret-test';
  process.env.VIEWS_INGEST_URL = `http://127.0.0.1:${server.address().port}/api/public/ingest-views`;
  const result = await pushViewsToSupabase();
  assert.equal(result.ok, false);
  assert.match(result.message, /404/);
  delete process.env.VIEWS_INGEST_URL;
  server.close();
});

test('trou de collecte : gain réparti sur les jours du trou selon la date de publication, total inchangé', async () => {
  const { buildDailyViewsRows: build, publishedDay } = await import('../src/supabaseViews.js');
  // id TikTok publié le 2026-09-20 (timestamp dans les 32 bits de poids fort)
  const ttId = (BigInt(Date.parse('2026-09-20T12:00:00Z') / 1000) << 32n).toString();
  assert.equal(publishedDay('tt', ttId), '2026-09-20');
  assert.equal(publishedDay('yt', 'abc'), null);

  const post = (id, views) => ({ id, views });
  const gapHistory = [
    { date: '2026-09-02', accounts: [{ account: 'A', ig: null, tt: 100, yt: 50, total: 150, errors: [], posts: { tt: [post('vieux', 100)], yt: [post('y1', 50)] } }] },
    { date: '2026-09-23', accounts: [{ account: 'A', ig: null, tt: 1000, yt: 350, total: 1350, errors: [], posts: { tt: [post(ttId, 1000)], yt: [post('y1', 70), post('y2', 280)] } }] }
  ];
  const rows = build(gapHistory);
  assert.equal(rows.length, 21); // du 03/09 au 23/09
  assert.ok(rows.every((r) => r.estimated === true && r.views === r.views_ig + r.views_tt + r.views_yt));
  assert.equal(rows.reduce((s, r) => s + r.views_tt, 0), 1000);
  assert.equal(rows.reduce((s, r) => s + r.views_yt, 0), 300); // +20 sur y1, 280 pour y2 (sans date)
  assert.equal(rows.filter((r) => r.day < '2026-09-20').reduce((s, r) => s + r.views_tt, 0), 0);
  // YouTube sans date : suit le rythme des vidéos datées du compte (TikTok publié le 20)
  const ytBefore = rows.filter((r) => r.day < '2026-09-20').reduce((s, r) => s + r.views_yt, 0);
  assert.ok(ytBefore >= 15 && ytBefore <= 17, `${ytBefore}`); // seuls les +20 de y1 (uniforme sur 21 j) avant le 20
});

test('collecte manquée (2 jours) : gain réparti sur les 2 jours, aucun jour vide', async () => {
  const { buildDailyViewsRows: build } = await import('../src/supabaseViews.js');
  const h = [
    { date: '2026-08-13', accounts: [{ account: 'A', ig: null, tt: 100, yt: null, total: 100, errors: [], posts: null }] },
    { date: '2026-08-15', accounts: [{ account: 'A', ig: null, tt: 300, yt: null, total: 300, errors: [], posts: null }] }
  ];
  const rows = build(h);
  assert.deepEqual(rows.map((r) => [r.day, r.views]), [['2026-08-14', 100], ['2026-08-15', 100]]);
});

test('cumul envoyé : plateforme plus suivie (URL vide) à 0, total inchangé', async () => {
  const { buildAccountViewsRows } = await import('../src/supabaseViews.js');
  const cumul = { kiksfryt: { total: 700, ig: 0, tt: 200, yt: 500 }, autre: { total: 10, ig: 10, tt: 0, yt: 0 } };
  const rows = buildAccountViewsRows(cumul, 'x', [{ name: 'kiksfryt', urls: ['', '', 'https://www.youtube.com/@keo_jvc'] }]);
  assert.deepEqual(rows.find((r) => r.account_name === 'kiksfryt'), { account_name: 'kiksfryt', total: 700, ig: 0, tt: 0, yt: 500, updated_at: 'x' });
  assert.equal(rows.find((r) => r.account_name === 'autre').ig, 10); // compte inconnu : inchangé
});

test('publications : une ligne par publication et par collecte, avec lien et date de publication', async () => {
  const { buildPostViewsRows, postUrl } = await import('../src/supabaseViews.js');
  const ttId = (BigInt(Date.parse('2026-09-20T12:00:00Z') / 1000) << 32n).toString();
  const urls = ['https://www.instagram.com/keo.wxc/', 'https://www.tiktok.com/@keo.wxc', 'https://www.youtube.com/@keowxc'];
  assert.equal(postUrl('ig', 'DaBzHa6seeM', urls), 'https://www.instagram.com/reel/DaBzHa6seeM/');
  assert.equal(postUrl('yt', 'iBZOW4dJv44', urls), 'https://www.youtube.com/shorts/iBZOW4dJv44');
  assert.equal(postUrl('tt', ttId, urls), `https://www.tiktok.com/@keo.wxc/video/${ttId}`);
  assert.equal(postUrl('tt', ttId, ['', '', 'https://www.youtube.com/@x']), null); // TikTok banni : pas de pseudo

  const h = [
    { date: '2026-09-26', accounts: [{ account: 'protow', posts: { tt: [{ id: ttId, views: 1000 }], yt: [{ id: 'y1', views: 50 }] } }] },
    { date: '2026-09-27', accounts: [{ account: 'protow', posts: { tt: [{ id: ttId, views: 80000 }] } }, { account: 'inconnu', posts: { tt: [{ id: ttId, views: 5 }] } }] }
  ];
  const rows = buildPostViewsRows(h, [{ name: 'protow', urls }]);
  assert.equal(rows.length, 3); // le TikTok du compte inconnu (sans pseudo) est ignoré
  assert.deepEqual(rows.find((r) => r.day === '2026-09-27'), {
    account_name: 'protow', platform: 'tt', post_id: ttId, url: `https://www.tiktok.com/@keo.wxc/video/${ttId}`,
    day: '2026-09-27', views: 80000, published_at: '2026-09-20T12:00:00.000Z'
  });
  assert.equal(rows.find((r) => r.platform === 'yt').published_at, null);
});
