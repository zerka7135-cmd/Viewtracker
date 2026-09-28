import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PUSH_STATUS_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vt-pushstatus-')), 'push-status.json');

const { getPushStatus, recordPushResult, markPushAlertSent, shouldAlertPushFailure, PUSH_STATUS_PATH } = await import('../src/pushStatus.js');
const { writeJsonAtomic } = await import('../src/jsonStore.js');

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const setStatus = (status) => writeJsonAtomic(PUSH_STATUS_PATH, status);

test('jamais envoyé : alerte immédiatement (pas d\'attente de 24h pour un tout premier échec)', () => {
  setStatus({ lastOkAt: null, lastAlertAt: null });
  assert.equal(shouldAlertPushFailure(), true);
});

test('dernier envoi réussi récent : pas d\'alerte, même après un échec juste après', () => {
  setStatus({ lastOkAt: hoursAgo(1), lastAlertAt: null });
  assert.equal(shouldAlertPushFailure(), false);
});

test('dernier envoi réussi il y a plus de 24h, jamais alerté : alerte', () => {
  setStatus({ lastOkAt: hoursAgo(25), lastAlertAt: null });
  assert.equal(shouldAlertPushFailure(), true);
});

test('alerte déjà envoyée récemment : pas de doublon tant que le cooldown n\'est pas passé', () => {
  setStatus({ lastOkAt: hoursAgo(25), lastAlertAt: hoursAgo(1) });
  assert.equal(shouldAlertPushFailure(), false);
});

test('alerte envoyée il y a longtemps, toujours en échec : nouvelle alerte autorisée', () => {
  setStatus({ lastOkAt: hoursAgo(48), lastAlertAt: hoursAgo(21) });
  assert.equal(shouldAlertPushFailure(), true);
});

test('recordPushResult(true) met à jour lastOkAt ; recordPushResult(false) le laisse intact', () => {
  setStatus({ lastOkAt: null, lastAlertAt: null });
  recordPushResult(true);
  const afterOk = getPushStatus().lastOkAt;
  assert.ok(afterOk);
  recordPushResult(false);
  assert.equal(getPushStatus().lastOkAt, afterOk);
});

test('markPushAlertSent : persiste et empêche une alerte immédiate suivante', () => {
  setStatus({ lastOkAt: hoursAgo(25), lastAlertAt: null });
  markPushAlertSent();
  assert.equal(shouldAlertPushFailure(), false);
  assert.ok(getPushStatus().lastAlertAt);
});
