import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../src/jsonStore.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-jsonstore-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('writeJsonAtomic : écrit le fichier sans laisser de fichier temporaire', () => {
  const file = path.join(dir, 'sub', 'data.json');
  writeJsonAtomic(file, { a: 1 });
  writeJsonAtomic(file, { a: 2 });
  assert.deepEqual(readJson(file, null), { a: 2 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['data.json']);
});

test('readJson : fichier absent -> valeur par défaut', () => {
  assert.deepEqual(readJson(path.join(dir, 'absent.json'), []), []);
});

test('readJson : fichier corrompu -> mis de côté (pas écrasé) et valeur par défaut', () => {
  const file = path.join(dir, 'history.json');
  fs.writeFileSync(file, '[{"date": "2026-09-01", "acc');
  assert.deepEqual(readJson(file, []), []);
  assert.equal(fs.existsSync(file), false);
  const quarantined = fs.readdirSync(dir).filter(f => f.startsWith('history.json.corrupt-'));
  assert.equal(quarantined.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, quarantined[0]), 'utf8'), '[{"date": "2026-09-01", "acc');
});
