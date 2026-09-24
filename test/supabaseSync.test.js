import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-sync-'));
process.env.CLICKS_DB_PATH = path.join(dir, 'clicks.db');
process.env.HISTORY_PATH = path.join(dir, 'history.json');
process.env.ACCOUNTS_STORE_PATH = path.join(dir, 'accounts.json');
process.env.SYNC_STATUS_PATH = path.join(dir, 'sync-status.json');
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CHANNEL_ID ||= 'test';
process.env.ACCOUNTS ||= '[]';

// Faux PostgREST : mêmes tables, pagination par en-tête Range, clé exigée.
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
const dayOffset = (n) => { const [y, m, d] = today.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10); };
const DATA = {
  clippers: [
    { id: 'c1', discord_name: 'Protow', rate_click: 0.25 },      // casse différente du compte : doit être relié
    { id: 'c2', discord_name: 'dj3b04', rate_click: 0.18 },
    { id: 'c3', discord_name: 'inconnu-au-bot', rate_click: 0.18 }
  ],
  daily_stats: [
    { clipper_id: 'c1', day: dayOffset(1), clicks: 100, optins: 5, cash: 50.5 },
    { clipper_id: 'c1', day: dayOffset(1), clicks: 20, optins: 1, cash: 0 },   // 2e ligne du même jour : additionnée
    { clipper_id: 'c2', day: dayOffset(2), clicks: 40, optins: 2, cash: 10 },
    { clipper_id: 'c3', day: dayOffset(1), clicks: 999, optins: 9, cash: 9 },
    { clipper_id: 'c1', day: dayOffset(60), clicks: 7, optins: 0, cash: 0 }    // trop ancien pour days=7
  ],
  daily_link_stats: [
    { clipper_id: 'c1', day: dayOffset(1), link_name: 'lien-a', clicks: 80 },
    { clipper_id: 'c1', day: dayOffset(1), link_name: 'lien-b', clicks: 40 }
  ]
};
// 2 500 lignes supplémentaires pour tester la pagination (3 pages de 1 000).
for (let i = 0; i < 2500; i++) DATA.daily_link_stats.push({ clipper_id: 'c3', day: dayOffset(1), link_name: `l${i}`, clicks: 1 });

const requests = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  requests.push({ path: url.pathname, key: req.headers.apikey, auth: req.headers.authorization });
  if (req.headers.apikey !== 'cle-test') { res.writeHead(401); return res.end('{}'); }

  const table = url.pathname.replace('/rest/v1/', '');
  let rows = DATA[table];
  if (!rows) { res.writeHead(404); return res.end('{}'); }
  const gte = url.searchParams.get('day');
  if (gte?.startsWith('gte.')) rows = rows.filter((r) => r.day >= gte.slice(4));
  const [start, end] = (req.headers.range || '0-999').split('-').map(Number);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(rows.slice(start, end + 1)));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_KEY = 'cle-test';

const { syncFromSupabase, getSyncStatus, isSyncConfigured } = await import('../src/supabaseSync.js');
const { getPeriodTotals, getLinkTotals } = await import('../src/clicksStore.js');
const { loadAccounts } = await import('../src/accountsStore.js');

test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

fs.writeFileSync(process.env.ACCOUNTS_STORE_PATH, JSON.stringify([
  { name: 'protow', urls: ['', '', ''] },
  { name: 'dj3b04', urls: ['', '', ''], rateClick: 0.3 }, // tarif déjà réglé ici : ne doit jamais être écrasé
  { name: 'autre', urls: ['', '', ''] }
]));

test('synchronise les jours récents : reliés par le nom (casse ignorée), jours additionnés', async () => {
  assert.equal(isSyncConfigured(), true);
  const result = await syncFromSupabase({ days: 7 });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.matched, 2);
  assert.deepEqual(result.unmatched, ['inconnu-au-bot']);

  const totals = getPeriodTotals();
  assert.deepEqual(totals.get('protow'), { clicks: 120, forms: 6, cashCents: 5050 }); // le jour d'il y a 60 jours est exclu
  assert.deepEqual(totals.get('dj3b04'), { clicks: 40, forms: 2, cashCents: 1000 });
  assert.equal(totals.has('autre'), false);
});

test('clics par lien (comptes reliés seulement) et pagination au-delà de 1 000 lignes', async () => {
  assert.deepEqual(getLinkTotals('protow'), [{ link: 'lien-a', clicks: 80 }, { link: 'lien-b', clicks: 40 }]);
  // Les 2 500 lignes du clipper inconnu ont été lues (3 pages) puis ignorées.
  const linkPages = requests.filter((r) => r.path.endsWith('daily_link_stats')).length;
  assert.equal(linkPages, 3);
});

test('tarif : repris de Supabase seulement s\'il n\'y en a pas déjà un', () => {
  const accounts = loadAccounts();
  assert.equal(accounts.find((a) => a.name === 'protow').rateClick, 0.25);
  assert.equal(accounts.find((a) => a.name === 'dj3b04').rateClick, 0.3);
});

test('rejouer la synchronisation remplace les jours, ne les additionne pas', async () => {
  await syncFromSupabase({ days: 7 });
  assert.equal(getPeriodTotals().get('protow').clicks, 120);
});

test('la clé est envoyée au serveur, le statut est enregistré sans elle', async () => {
  assert.ok(requests.every((r) => r.key === 'cle-test' && r.auth === 'Bearer cle-test'));
  const { last } = getSyncStatus();
  assert.equal(last.ok, true);
  assert.equal(JSON.stringify(last).includes('cle-test'), false);
});

test('mauvaise clé : échec propre, sans exception', async () => {
  process.env.SUPABASE_KEY = 'mauvaise';
  const result = await syncFromSupabase({ days: 7 });
  process.env.SUPABASE_KEY = 'cle-test';
  assert.equal(result.ok, false);
  assert.match(result.message, /HTTP 401/);
});

test('non configuré : message clair, aucune requête', async () => {
  const savedUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  const before = requests.length;
  const result = await syncFromSupabase();
  process.env.SUPABASE_URL = savedUrl;
  assert.equal(result.ok, false);
  assert.match(result.message, /non configuré/);
  assert.equal(requests.length, before);
});
