import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PUBLICATIONS_LOG_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vt-pubslog-')), 'publications-log.json');
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CHANNEL_ID ||= 'test';
process.env.ACCOUNTS ||= '[]';

const { recordSeenPublications, loadPublicationsLog, renameAccountInPublicationsLog, getPublicationsPerDay } = await import('../src/publicationsLog.js');

const item = (account, seenPosts) => ({ account, seenPosts });
const posts = (...ids) => ids.map((id) => ({ id, views: 1 }));

test('enregistre les publications repérées, une seule fois par plateforme+id', () => {
  const summary = [item('protow', { ig: posts('a', 'b'), tt: posts('t1'), yt: [] })];
  const added = recordSeenPublications(summary, '2026-09-29');
  assert.equal(added, 3);
  const log = loadPublicationsLog();
  assert.equal(log.length, 3);
  assert.deepEqual(log.find((p) => p.id === 'a'), { account: 'protow', platform: 'ig', id: 'a', firstSeenDay: '2026-09-29' });
});

test('une publication déjà connue n\'est jamais dupliquée ni réécrite (même si elle change de compte par erreur)', () => {
  const before = loadPublicationsLog().length;
  const summary = [item('protow', { ig: posts('a'), tt: [], yt: [] }), item('autre', { ig: posts('a'), tt: [], yt: [] })];
  const added = recordSeenPublications(summary, '2026-09-30');
  assert.equal(added, 0);
  assert.equal(loadPublicationsLog().length, before);
  assert.equal(loadPublicationsLog().find((p) => p.id === 'a').firstSeenDay, '2026-09-29'); // inchangé
});

test('deux plateformes différentes avec le même id ne se confondent pas', () => {
  const summary = [item('protow', { ig: [], tt: posts('samekey'), yt: posts('samekey') })];
  recordSeenPublications(summary, '2026-10-01');
  const log = loadPublicationsLog();
  assert.equal(log.filter((p) => p.id === 'samekey').length, 2);
});

test('getPublicationsPerDay : TikTok/Instagram groupés par jour réel de publication, YouTube par jour de première apparition', () => {
  // id TikTok publié le 2026-09-20 (timestamp dans les 32 bits de poids fort)
  const ttId = (BigInt(Date.parse('2026-09-20T12:00:00Z') / 1000) << 32n).toString();
  recordSeenPublications([item('perdayaccount', { ig: [], tt: posts(ttId), yt: posts('yt-perdaytest') })], '2026-09-23');
  const { tt_ig, yt } = getPublicationsPerDay({ account: 'perdayaccount' });
  assert.deepEqual(tt_ig, { '2026-09-20': 1 }); // date réelle, pas le jour de collecte
  assert.deepEqual(yt, { '2026-09-23': 1 }); // pas de date réelle -> jour de première apparition
});

test('renameAccountInPublicationsLog migre toutes les entrées du compte', () => {
  renameAccountInPublicationsLog('protow', 'protowNouveau');
  const log = loadPublicationsLog();
  assert.ok(log.filter((p) => p.account === 'protow').length === 0);
  assert.ok(log.some((p) => p.account === 'protowNouveau' && p.id === 'a'));
});
