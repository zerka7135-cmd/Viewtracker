import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidApiKey, parseClickEntries, MAX_ENTRIES } from '../src/clickIngest.js';

const known = ['protow', 'dj3b04'];
const today = '2026-09-24';

test('isValidApiKey : bonne clé acceptée, mauvaise ou absente refusée', () => {
  assert.equal(isValidApiKey('Bearer secret-123', 'secret-123'), true);
  assert.equal(isValidApiKey('Bearer autre', 'secret-123'), false);
  assert.equal(isValidApiKey('secret-123', 'secret-123'), false); // sans "Bearer"
  assert.equal(isValidApiKey(undefined, 'secret-123'), false);
});

test('isValidApiKey : clé attendue vide -> personne n\'est autorisé', () => {
  assert.equal(isValidApiKey('Bearer ', ''), false);
  assert.equal(isValidApiKey('Bearer x', undefined), false);
});

test('parseClickEntries : entrées valides, source par défaut puis source par entrée', () => {
  const { valid, rejected } = parseClickEntries({
    source: 'bitly',
    entries: [
      { account: 'protow', date: '2026-09-24', clicks: 132 },
      { account: 'dj3b04', date: '2026-09-23', clicks: 0, source: 'linktree' }
    ]
  }, known, today);
  assert.deepEqual(rejected, []);
  assert.deepEqual(valid, [
    { account: 'protow', date: '2026-09-24', source: 'bitly', clicks: 132, forms: null, cashCents: null },
    { account: 'dj3b04', date: '2026-09-23', source: 'linktree', clicks: 0, forms: null, cashCents: null }
  ]);
});

test('parseClickEntries : rejette compte inconnu, dates invalides ou futures, clics invalides', () => {
  const { valid, rejected } = parseClickEntries({
    entries: [
      { account: 'inconnu', date: '2026-09-24', clicks: 1 },
      { account: 'protow', date: '2026-02-30', clicks: 1 },
      { account: 'protow', date: '24/09/2026', clicks: 1 },
      { account: 'protow', date: '2026-09-25', clicks: 1 },
      { account: 'protow', date: '2026-09-24', clicks: -3 },
      { account: 'protow', date: '2026-09-24', clicks: 1.5 },
      { account: 'protow', date: '2026-09-24', clicks: '12' },
      { account: 'protow', date: '2026-09-24', clicks: 5, source: 'a b!' },
      null,
      { account: 'protow', date: '2026-09-24', clicks: 7 }
    ]
  }, known, today);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].clicks, 7);
  assert.deepEqual(rejected.map(r => r.index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('parseClickEntries : forms et cash (en euros -> centimes), champs indépendants', () => {
  const { valid, rejected } = parseClickEntries({
    entries: [
      { account: 'protow', date: '2026-09-24', clicks: 573, forms: 21, cash: 1385 },
      { account: 'protow', date: '2026-09-23', cash: 49.9 },
      { account: 'protow', date: '2026-09-22', forms: 3 }
    ]
  }, known, today);
  assert.deepEqual(rejected, []);
  assert.deepEqual(valid.map(v => [v.clicks, v.forms, v.cashCents]), [[573, 21, 138500], [null, null, 4990], [null, 3, null]]);
});

test('parseClickEntries : sans aucun champ, forms/cash invalides -> rejet', () => {
  const { valid, rejected } = parseClickEntries({
    entries: [
      { account: 'protow', date: '2026-09-24' },
      { account: 'protow', date: '2026-09-24', cash: 1.234 },
      { account: 'protow', date: '2026-09-24', cash: -5 },
      { account: 'protow', date: '2026-09-24', cash: '12' },
      { account: 'protow', date: '2026-09-24', forms: 2.5 }
    ]
  }, known, today);
  assert.equal(valid.length, 0);
  assert.equal(rejected.length, 5);
});

test('parseClickEntries : corps invalide, vide ou trop gros -> erreur globale', () => {
  assert.match(parseClickEntries(null, known, today).error, /Corps invalide/);
  assert.match(parseClickEntries({ entries: 'x' }, known, today).error, /Corps invalide/);
  assert.match(parseClickEntries({ entries: [] }, known, today).error, /Aucune entrée/);
  const tooMany = { entries: Array.from({ length: MAX_ENTRIES + 1 }, () => ({})) };
  assert.match(parseClickEntries(tooMany, known, today).error, /Trop d'entrées/);
});
