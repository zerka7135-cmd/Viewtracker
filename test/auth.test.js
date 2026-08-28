import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// AUTH_PATH est résolu une seule fois au chargement du module (voir
// auth.js) — doit donc être fixé *avant* l'import, vers un fichier
// temporaire dédié à ces tests plutôt que data/auth.json (jamais toucher
// aux vraies données locales/de prod depuis une suite de tests).
const tmpAuthPath = path.join(os.tmpdir(), `vt-auth-test-${process.pid}-${Date.now()}.json`);
process.env.AUTH_PATH = tmpAuthPath;

const auth = await import('../src/auth.js');

test.after(() => {
  fs.rmSync(tmpAuthPath, { force: true });
});

// Fabrique un req/res minimal pour tester setSessionCookie/getSessionEmail
// sans dépendre d'un vrai serveur Express — seule l'API réellement utilisée
// par auth.js est mockée (req.secure/get, res.cookie/clearCookie).
function fakeReqRes() {
  let cookieHeader = null;
  const req = {
    secure: true,
    get: () => undefined,
    headers: { get cookie() { return cookieHeader; } }
  };
  const res = {
    cookie: (name, value) => { cookieHeader = `${name}=${encodeURIComponent(value)}`; },
    clearCookie: () => { cookieHeader = null; }
  };
  return { req, res, getCookieHeader: () => cookieHeader };
}

test('setInitialPassword puis addUser : deux comptes, chacun se connecte avec son propre mot de passe', async () => {
  await auth.setInitialPassword('vincent@exemple.com', 'motdepasse1');
  assert.equal(await auth.isPasswordSet(), true);

  await auth.addUser('collegue@exemple.com', 'motdepasse2');
  assert.deepEqual(auth.listEmails(), ['collegue@exemple.com', 'vincent@exemple.com']);

  assert.equal(await auth.checkPassword('vincent@exemple.com', 'motdepasse1'), true);
  assert.equal(await auth.checkPassword('collegue@exemple.com', 'motdepasse2'), true);
  // mots de passe croisés -> refusés
  assert.equal(await auth.checkPassword('vincent@exemple.com', 'motdepasse2'), false);
  assert.equal(await auth.checkPassword('inconnu@exemple.com', 'motdepasse1'), false);
});

test('setInitialPassword refuse un second appel une fois un compte déjà configuré', async () => {
  await assert.rejects(() => auth.setInitialPassword('autre@exemple.com', 'motdepasse3'), /déjà configuré/);
});

test('addUser refuse un e-mail invalide ou déjà pris', async () => {
  await assert.rejects(() => auth.addUser('pasunemail', 'motdepasse4'), /invalide/);
  await assert.rejects(() => auth.addUser('vincent@exemple.com', 'motdepasse4'), /déjà utilisée/);
});

test('removeUser refuse de supprimer le dernier compte restant', async () => {
  // À ce stade : vincent@ + collegue@ existent (2 comptes) -> en retirer un
  // doit marcher, puis retirer le dernier restant doit être refusé.
  auth.removeUser('collegue@exemple.com');
  assert.deepEqual(auth.listEmails(), ['vincent@exemple.com']);
  assert.throws(() => auth.removeUser('vincent@exemple.com'), /dernier compte/);
});

test('changePassword : refusé si le mot de passe actuel est incorrect, accepté sinon', async () => {
  await assert.rejects(
    () => auth.changePassword('vincent@exemple.com', 'mauvais', 'nouveaumotdepasse'),
    /incorrect/
  );
  await auth.changePassword('vincent@exemple.com', 'motdepasse1', 'nouveaumotdepasse');
  assert.equal(await auth.checkPassword('vincent@exemple.com', 'nouveaumotdepasse'), true);
  assert.equal(await auth.checkPassword('vincent@exemple.com', 'motdepasse1'), false);
});

test('checkPassword : temps de réponse comparable pour un e-mail inconnu et un e-mail existant (pas d\'énumération de comptes par timing)', async () => {
  // Avant correctif : un e-mail inconnu retournait instantanément (aucun
  // scrypt lancé) pendant qu'un e-mail existant avec un mauvais mot de
  // passe prenait ~45ms (mesuré) — un attaquant pouvait deviner quels
  // e-mails ont un compte rien qu'en chronométrant /api/login. Tolérance
  // large (ratio, pas un seuil en ms absolu) pour rester fiable sur une
  // machine CI plus lente/rapide : on vérifie l'ordre de grandeur, pas une
  // valeur précise.
  const N = 8;
  let tKnown = 0, tUnknown = 0;
  for (let i = 0; i < N; i++) {
    let t0 = Date.now();
    await auth.checkPassword('vincent@exemple.com', 'mauvais-mdp');
    tKnown += Date.now() - t0;

    t0 = Date.now();
    await auth.checkPassword(`inconnu-${i}@exemple.com`, 'mauvais-mdp');
    tUnknown += Date.now() - t0;
  }
  // tUnknown doit être au moins 30% de tKnown — avant correctif, c'était ~0%.
  assert.ok(tUnknown >= tKnown * 0.3, `tUnknown=${tUnknown}ms trop rapide par rapport à tKnown=${tKnown}ms`);
});

test('session cookie : setSessionCookie -> getSessionEmail retrouve le bon compte', () => {
  const { req, res, getCookieHeader } = fakeReqRes();
  auth.setSessionCookie(req, res, 'vincent@exemple.com');

  const reqWithCookie = { headers: { cookie: getCookieHeader() } };
  assert.equal(auth.getSessionEmail(reqWithCookie), 'vincent@exemple.com');
  assert.equal(auth.isAuthenticated(reqWithCookie), true);
});

test('session cookie : invalidée par un changement de mot de passe sur CE compte', async () => {
  const { req, res, getCookieHeader } = fakeReqRes();
  auth.setSessionCookie(req, res, 'vincent@exemple.com');
  const reqWithCookie = { headers: { cookie: getCookieHeader() } };
  assert.equal(auth.isAuthenticated(reqWithCookie), true);

  await auth.changePassword('vincent@exemple.com', 'nouveaumotdepasse', 'encoreunautre');
  assert.equal(auth.isAuthenticated(reqWithCookie), false);
});

test('session cookie : un cookie trafiqué (signature invalide) est rejeté', () => {
  const reqWithBadCookie = { headers: { cookie: 'vt_session=vincent%40exemple.com%3A123%3Aabc.fakemac' } };
  assert.equal(auth.isAuthenticated(reqWithBadCookie), false);
});

test('rate-limit de connexion : délai progressif par IP après 3 échecs, isolé entre IPs', () => {
  const ipA = '203.0.113.10';
  const ipB = '203.0.113.20';

  for (let i = 0; i < 3; i++) auth.recordLoginFailure(ipA);
  assert.equal(auth.loginDelayMs(ipA), 0); // encore sous le seuil

  auth.recordLoginFailure(ipA);
  assert.ok(auth.loginDelayMs(ipA) > 0);
  assert.equal(auth.loginDelayMs(ipB), 0); // IP différente, pas affectée

  auth.recordLoginSuccess(ipA);
  assert.equal(auth.loginDelayMs(ipA), 0); // remis à zéro par le succès
});

test('rate-limit de connexion : alerte owner une seule fois par série d\'échecs', () => {
  const ip = '203.0.113.30';
  let alerts = 0;
  for (let i = 0; i < 6; i++) {
    auth.recordLoginFailure(ip);
    if (auth.shouldAlertOwner(ip)) alerts++;
  }
  assert.equal(alerts, 1);
});
