import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Démarre le vrai serveur (données dans un dossier temporaire) et vérifie,
// pour chaque profil, ce que l'API accepte ou refuse : les droits sont
// appliqués côté serveur, pas seulement masqués dans l'interface.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-roles-'));
const file = (name) => path.join(dir, name);
const PORT = 30000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'motdepasse-solide';
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

const env = {
  ...process.env,
  PORT: String(PORT),
  AUTH_PATH: file('auth.json'), ACCOUNTS_STORE_PATH: file('accounts.json'), HISTORY_PATH: file('history.json'),
  CUMULATIVE_VIEWS_PATH: file('cumulative.json'), SETTINGS_PATH: file('settings.json'), CLICKS_DB_PATH: file('clicks.db'),
  LOCK_PATH: file('lock'), LAST_MESSAGE_PATH: file('last.json'), SCAN_STATUS_PATH: file('scan.json'),
  BOT_CONFIG_PATH: file('bot.json'), SYNC_STATUS_PATH: file('sync.json'),
  DISCORD_TOKEN: 'test', DISCORD_CHANNEL_ID: 'test', ACCOUNTS: '[]', CLICKS_API_KEY: 'cle-ingest'
};
delete env.SUPABASE_URL; delete env.SUPABASE_KEY;

fs.writeFileSync(file('accounts.json'), JSON.stringify([
  { name: 'alpha', urls: ['', '', ''] }, { name: 'beta', urls: ['', '', ''] }
]));

// Utilisateurs créés avec le même module que le serveur (même fichier).
Object.assign(process.env, { AUTH_PATH: env.AUTH_PATH });
const auth = await import('../src/auth.js');
await auth.setInitialPassword('admin@x.fr', PASSWORD);
await auth.addUser('manager@x.fr', PASSWORD, { role: 'manager' });
await auth.addUser('clip@x.fr', PASSWORD, { role: 'clipper', account: 'alpha' });

let server;
test.before(async () => {
  server = spawn(process.execPath, ['--input-type=module', '-e', "const {startServer}=await import(process.cwd()+'/src/server.js');await startServer();"], { env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${BASE}/api/me`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('serveur non démarré');
});
test.after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const cookies = {};
async function login(name, email) {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  assert.equal(res.status, 200, `connexion ${name}`);
  cookies[name] = res.headers.get('set-cookie').split(';')[0];
}
async function call(who, method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookies[who] ? { cookie: cookies[who] } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corps vide */ }
  return { status: res.status, json, text };
}
const period = `from=${today}&to=${today}`;

test('connexions et /api/me renvoie le rôle et le compte lié', async () => {
  await login('admin', 'admin@x.fr'); await login('manager', 'manager@x.fr'); await login('clipper', 'clip@x.fr');
  assert.deepEqual((await call('admin', 'GET', '/api/me')).json.role, 'admin');
  assert.deepEqual((await call('manager', 'GET', '/api/me')).json.role, 'manager');
  const me = (await call('clipper', 'GET', '/api/me')).json;
  assert.deepEqual([me.role, me.account], ['clipper', 'alpha']);
});

test('sans session : tout est refusé (401)', async () => {
  for (const url of ['/api/dashboard', '/api/clippers', '/api/clipper', '/api/leaderboard', '/api/users', '/api/settings']) {
    assert.equal((await call('personne', 'GET', url)).status, 401, url);
  }
});

test('admin : accès à tout', async () => {
  for (const url of ['/api/dashboard', '/api/settings', '/api/users', '/api/bot-config', '/api/history', '/api/scan/status', '/api/admin/sync',
    `/api/clippers?${period}`, `/api/leaderboard?${period}`, `/api/daily?${period}`, `/api/clipper?account=beta&${period}`]) {
    assert.equal((await call('admin', 'GET', url)).status, 200, url);
  }
});

test('manager : vues et clics de tous les clippers, mais ni réglages ni gestion', async () => {
  for (const url of ['/api/dashboard', '/api/history', '/api/scan/status', `/api/clippers?${period}`, `/api/leaderboard?${period}`,
    `/api/daily?${period}`, `/api/clipper?account=beta&${period}`]) {
    assert.equal((await call('manager', 'GET', url)).status, 200, url);
  }
  for (const [method, url, body] of [
    ['GET', '/api/settings'], ['PATCH', '/api/settings', { postsLimit: 9 }], ['GET', '/api/bot-config'], ['PATCH', '/api/bot-config', { discordToken: 'x' }],
    ['GET', '/api/users'], ['POST', '/api/users', { email: 'z@x.fr', password: PASSWORD, role: 'admin' }], ['PATCH', '/api/users/clip@x.fr', { role: 'admin' }],
    ['DELETE', '/api/users/clip@x.fr'], ['POST', '/api/accounts', { name: 'gamma' }], ['PATCH', '/api/accounts/alpha', { name: 'zz' }],
    ['DELETE', '/api/accounts/alpha'], ['PATCH', '/api/accounts/alpha/rate', { ratePer1000: 999 }], ['GET', '/api/admin/sync'], ['POST', '/api/admin/sync', {}]
  ]) {
    assert.equal((await call('manager', method, url, body)).status, 403, `${method} ${url}`);
  }
});

test('clipper : uniquement sa page et le classement', async () => {
  assert.equal((await call('clipper', 'GET', `/api/leaderboard?${period}`)).status, 200);
  assert.equal((await call('clipper', 'GET', `/api/clipper?${period}`)).status, 200);

  for (const url of ['/api/dashboard', '/api/history', '/api/scan/status', '/api/settings', '/api/users', '/api/bot-config', '/api/admin/sync',
    `/api/clippers?${period}`, `/api/daily?${period}`, '/api/clicks/history']) {
    assert.equal((await call('clipper', 'GET', url)).status, 403, url);
  }
  assert.equal((await call('clipper', 'DELETE', '/api/accounts/alpha')).status, 403);
  assert.equal((await call('clipper', 'PATCH', '/api/users/admin@x.fr', { role: 'clipper', account: 'alpha' })).status, 403);
});

test('un clipper ne peut pas lire le compte d\'un autre, même en le demandant', async () => {
  const res = await call('clipper', 'GET', `/api/clipper?account=beta&${period}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.name, 'alpha'); // le paramètre est ignoré : c'est toujours son propre compte
});

test('finances : jamais de cash/bénéfice/ROAS pour le manager, jamais de gains d\'autrui dans le classement clipper', async () => {
  // Données : 100 clics et du cash pour alpha, via l'API d'ingestion.
  const ingest = await fetch(`${BASE}/api/ingest/clicks`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer cle-ingest' },
    body: JSON.stringify({ entries: [{ account: 'alpha', date: today, clicks: 100, forms: 5, cash: 200 }, { account: 'beta', date: today, clicks: 50 }] })
  });
  assert.equal(ingest.status, 200);

  const manager = await call('manager', 'GET', `/api/clippers?${period}`);
  assert.doesNotMatch(manager.text, /"(cash|profit|roas|toPay)"/);
  assert.equal(manager.json.rows.length, 2);

  const admin = await call('admin', 'GET', `/api/clippers?${period}`);
  assert.ok(admin.json.kpis.cash > 0 && 'profit' in admin.json.kpis && 'roas' in admin.json.kpis);

  const board = await call('clipper', 'GET', `/api/leaderboard?${period}`);
  assert.doesNotMatch(board.text, /earnings/);
  assert.match((await call('admin', 'GET', `/api/leaderboard?${period}`)).text, /earnings/);
});

test('gestion des utilisateurs (admin) : rôle modifiable, dernier admin protégé', async () => {
  const promoted = await call('admin', 'PATCH', '/api/users/manager@x.fr', { role: 'clipper', account: 'beta' });
  assert.equal(promoted.status, 200);
  assert.deepEqual(promoted.json.users.find((u) => u.email === 'manager@x.fr'), { email: 'manager@x.fr', role: 'clipper', account: 'beta' });

  assert.equal((await call('admin', 'PATCH', '/api/users/clip@x.fr', { role: 'clipper', account: 'inexistant' })).status, 400);
  assert.equal((await call('admin', 'PATCH', '/api/users/admin@x.fr', { role: 'manager' })).status, 400); // dernier admin
  assert.equal((await call('admin', 'DELETE', '/api/users/admin@x.fr')).status, 400);
});

test('tarif par clic (admin) : saisi en € pour 1 000 clics', async () => {
  const res = await call('admin', 'PATCH', '/api/accounts/alpha/rate', { ratePer1000: 250 });
  assert.equal(res.status, 200);
  assert.equal(res.json.accounts.find((a) => a.name === 'alpha').rateClick, 0.25);
  assert.equal((await call('admin', 'PATCH', '/api/accounts/alpha/rate', { ratePer1000: -5 })).status, 400);
  assert.equal((await call('admin', 'PATCH', '/api/accounts/nope/rate', { ratePer1000: 1 })).status, 404);
});
