import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-auth-'));
process.env.AUTH_PATH = path.join(dir, 'auth.json');

const auth = await import('../src/auth.js');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const PASSWORD = 'motdepasse-solide';

test('un compte créé avant les rôles (sans rôle enregistré) est admin', () => {
  fs.writeFileSync(process.env.AUTH_PATH, JSON.stringify({ users: [{ email: 'vieux@x.fr', passwordHash: 'scrypt$x$y', createdAt: '2026-01-01' }] }));
  assert.deepEqual(auth.listUsers(), [{ email: 'vieux@x.fr', role: 'admin', account: null }]);
});

test('addUser : rôles valides, clipper lié à un compte, compte ignoré pour les autres rôles', async () => {
  fs.writeFileSync(process.env.AUTH_PATH, JSON.stringify({ users: [] }));
  await auth.setInitialPassword('admin@x.fr', PASSWORD);
  await auth.addUser('manager@x.fr', PASSWORD, { role: 'manager', account: 'ignore' });
  await auth.addUser('clip@x.fr', PASSWORD, { role: 'clipper', account: 'protow' });

  assert.deepEqual(auth.listUsers(), [
    { email: 'admin@x.fr', role: 'admin', account: null },
    { email: 'clip@x.fr', role: 'clipper', account: 'protow' },
    { email: 'manager@x.fr', role: 'manager', account: null }
  ]);

  await assert.rejects(auth.addUser('x@x.fr', PASSWORD, { role: 'clipper' }), /lié à un compte/);
  await assert.rejects(auth.addUser('y@x.fr', PASSWORD, { role: 'superadmin' }), /Rôle invalide/);
});

test('updateUserAccess : change le rôle, mais jamais en retirant le dernier admin', () => {
  auth.updateUserAccess('manager@x.fr', { role: 'clipper', account: 'dj3b04' });
  assert.equal(auth.listUsers().find((u) => u.email === 'manager@x.fr').account, 'dj3b04');

  assert.throws(() => auth.updateUserAccess('admin@x.fr', { role: 'manager' }), /dernier admin/);
  assert.throws(() => auth.updateUserAccess('inconnu@x.fr', { role: 'admin' }), /introuvable/);
});

test('removeUser : refuse de supprimer le dernier admin', () => {
  assert.throws(() => auth.removeUser('admin@x.fr'), /dernier admin/);
  auth.removeUser('clip@x.fr'); // un clipper se supprime normalement
  assert.equal(auth.listUsers().some((u) => u.email === 'clip@x.fr'), false);
});
