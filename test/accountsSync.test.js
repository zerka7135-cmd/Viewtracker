import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-accsync-'));
process.env.ACCOUNTS_STORE_PATH = path.join(dir, 'accounts.json');
process.env.HISTORY_PATH = path.join(dir, 'history.json');
process.env.CUMULATIVE_VIEWS_PATH = path.join(dir, 'cumulative.json');
process.env.CLICKS_DB_PATH = path.join(dir, 'clicks.db');
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CHANNEL_ID ||= 'test';
process.env.ACCOUNTS ||= '[]';

const accounts = [
  { name: 'protow', urls: ['https://www.instagram.com/keo.wxc/', 'https://www.tiktok.com/@keo.wxc', 'https://www.youtube.com/@keowxc'], rateClick: 0.2 },
  { name: 'digital.balian', urls: ['', 'https://www.tiktok.com/@keo.mdst', 'https://www.youtube.com/@Keorisen'] },
  { name: 'kiksfryt', urls: ['', '', 'https://www.youtube.com/@keo_jvc'] },
  { name: 'ancien', urls: ['', 'https://www.tiktok.com/@ancien', ''] }
];
fs.writeFileSync(process.env.ACCOUNTS_STORE_PATH, JSON.stringify(accounts));
fs.writeFileSync(process.env.HISTORY_PATH, JSON.stringify([{ date: '2026-09-20', accounts: [{ account: 'kiksfryt', ig: null, tt: null, yt: 10, total: 10, errors: [] }] }]));
fs.writeFileSync(process.env.CUMULATIVE_VIEWS_PATH, JSON.stringify({ kiksfryt: { total: 500, ig: 0, tt: 0, yt: 500 }, ancien: { total: 42, ig: 0, tt: 42, yt: 0 } }));

let body;
let etag = '"v1"';
let acceptedSecret = 'secret-test';
const requests = [];
const server = http.createServer((req, res) => {
  requests.push({ inm: req.headers['if-none-match'] });
  if (req.headers['x-ingest-secret'] !== acceptedSecret) { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); return res.end(); }
  res.writeHead(200, { 'content-type': 'application/json', etag });
  res.end(JSON.stringify(body));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.ACCOUNTS_SYNC_URL = `http://127.0.0.1:${server.address().port}/api/public/clipper-accounts`;
process.env.VIEWS_INGEST_SECRET = 'secret-test';

const { syncAccountsFromApp, resetAccountsSyncCache } = await import('../src/accountsSync.js');
const { loadAccounts } = await import('../src/accountsStore.js');
const { loadCumulativeViews } = await import('../src/cumulativeViews.js');
const find = (name) => loadAccounts().find((a) => a.name === name);

test('premier passage : lien par le nom, ajout, pseudo modifié, retrait (données gardées)', async () => {
  body = {
    updated_at: '2026-09-26T10:00:00Z',
    clippers: [
      { clipper_id: 'id-protow', name: 'protow', accounts: [{ platform: 'ig', handle: 'keo.wxc' }, { platform: 'tt', handle: 'keo.wxc' }, { platform: 'yt', handle: 'keowxc' }] },
      // même pseudo YouTube en minuscules : l'URL actuelle (avec majuscule) est gardée
      { clipper_id: 'id-balian', name: 'digital.balian', accounts: [{ platform: 'tt', handle: 'keo.mdst' }, { platform: 'yt', handle: 'keorisen' }] },
      // pseudo YouTube changé
      { clipper_id: 'id-kiks', name: 'kiksfryt', accounts: [{ platform: 'yt', handle: '@keo_new' }] },
      { clipper_id: 'id-new', name: 'nouveau', accounts: [{ platform: 'tt', handle: 'keo.nouveau' }] },
      { clipper_id: 'id-vide', name: 'sansreseau', accounts: [] }
    ]
  };
  const result = await syncAccountsFromApp();
  assert.equal(result.ok, true, result.message);

  assert.equal(find('protow').clipperId, 'id-protow');
  assert.equal(find('protow').rateClick, 0.2);
  assert.deepEqual(find('digital.balian').urls, accounts[1].urls);
  assert.deepEqual(find('kiksfryt').urls, ['', '', 'https://www.youtube.com/@keo_new']);
  assert.deepEqual(find('nouveau'), { name: 'nouveau', urls: ['', 'https://www.tiktok.com/@keo.nouveau', ''], clipperId: 'id-new' });
  assert.equal(find('ancien'), undefined);
  assert.equal(find('sansreseau'), undefined);
  assert.equal(loadCumulativeViews().ancien.total, 42);
});

test('rien de changé côté app : 304, aucune écriture', async () => {
  const before = fs.readFileSync(process.env.ACCOUNTS_STORE_PATH, 'utf8');
  const result = await syncAccountsFromApp();
  assert.equal(result.message, 'Comptes inchangés');
  assert.equal(requests.at(-1).inm, '"v1"');
  assert.equal(fs.readFileSync(process.env.ACCOUNTS_STORE_PATH, 'utf8'), before);
});

test('renommage dans l\'app (même id) : compte renommé, historique et cumul migrés', async () => {
  etag = '"v2"';
  body.clippers[2] = { ...body.clippers[2], name: 'Kiks' };
  const result = await syncAccountsFromApp();
  assert.equal(result.ok, true, result.message);
  assert.equal(find('kiksfryt'), undefined);
  assert.equal(find('Kiks').clipperId, 'id-kiks');
  assert.equal(loadCumulativeViews().Kiks.total, 500);
  assert.equal(JSON.parse(fs.readFileSync(process.env.HISTORY_PATH, 'utf8'))[0].accounts[0].account, 'Kiks');
});

test('garde-fous : liste vide ou retrait massif refusés, rien n\'est modifié', async () => {
  const before = fs.readFileSync(process.env.ACCOUNTS_STORE_PATH, 'utf8');
  etag = '"v3"';
  body = { updated_at: 'x', clippers: [] };
  assert.match((await syncAccountsFromApp()).message, /liste vide/);

  etag = '"v4"';
  body = { updated_at: 'x', clippers: [{ clipper_id: 'id-new', name: 'nouveau', accounts: [{ platform: 'tt', handle: 'keo.nouveau' }] }] };
  assert.match((await syncAccountsFromApp()).message, /refusé par sécurité/);
  assert.equal(fs.readFileSync(process.env.ACCOUNTS_STORE_PATH, 'utf8'), before);
});

test('simulation : plan renvoyé, même refusé par les garde-fous, sans rien écrire', async () => {
  const before = fs.readFileSync(process.env.ACCOUNTS_STORE_PATH, 'utf8');
  etag = '"v5"';
  const result = await syncAccountsFromApp({ dryRun: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.remove.sort(), ['Kiks', 'digital.balian', 'protow']);
  assert.equal(fs.readFileSync(process.env.ACCOUNTS_STORE_PATH, 'utf8'), before);
});

test('secret refusé : échec propre, sans exception', async () => {
  resetAccountsSyncCache();
  acceptedSecret = 'autre';
  const result = await syncAccountsFromApp();
  assert.equal(result.ok, false);
  assert.match(result.message, /401/);
  server.close();
});
