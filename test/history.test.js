import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGrowth24h, detectStuckAccounts } from '../src/history.js';

// Formate une date en YYYY-MM-DD dans le fuseau Europe/Paris, comme le
// fait le code testé (voir history.js#todayKey) — construit ici plutôt
// qu'en dur pour que les tests restent valides quel que soit le jour où
// ils tournent.
function dateKey(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

test('computeGrowth24h : delta positif simple par plateforme (repli sur le total brut, pas de posts avec ID)', () => {
  const history = [
    { date: dateKey(2), accounts: [{ account: 'compteA', ig: 100, tt: 50, yt: 0 }] }
  ];
  const summary = [{ account: 'compteA', ig: 140, tt: 80, yt: 0 }];

  const result = computeGrowth24h(history, summary);
  assert.deepEqual(result.get('compteA'), { total: 70, ig: 40, tt: 30, yt: 0 });
});

test('computeGrowth24h : jamais négatif (compte temporairement banni entre les deux collectes)', () => {
  const history = [
    { date: dateKey(2), accounts: [{ account: 'compteA', ig: 100, tt: 50, yt: 20 }] }
  ];
  // ig passe à null (banni) : le delta IG doit être 0, pas négatif, et ne
  // doit pas faire chuter le total global calculé à partir des autres
  // plateformes (voir le commentaire dans history.js sur ce point précis).
  const summary = [{ account: 'compteA', ig: null, tt: 80, yt: 20 }];

  const result = computeGrowth24h(history, summary);
  assert.deepEqual(result.get('compteA'), { total: 30, ig: 0, tt: 30, yt: 0 });
});

test('computeGrowth24h : delta par vidéo (via posts[].id) plutôt que par total brut quand disponible', () => {
  const history = [
    {
      date: dateKey(2),
      accounts: [{
        account: 'compteA',
        ig: 1000,
        tt: 0,
        yt: 0,
        posts: { ig: [{ id: 'v1', views: 600 }, { id: 'v2', views: 400 }], tt: [], yt: [] }
      }]
    }
  ];
  const summary = [{
    account: 'compteA',
    ig: 1300, // total brut aurait donné un delta de 300
    tt: 0,
    yt: 0,
    posts: {
      // v1 gagne 150, v2 disparaît de la fenêtre suivie (nouveau post),
      // v3 est nouveau (compté en entier) : delta réel = 150 + 250 = 400,
      // différent du delta sur le total brut (300).
      ig: [{ id: 'v1', views: 750 }, { id: 'v3', views: 250 }],
      tt: [],
      yt: []
    }
  }];

  const result = computeGrowth24h(history, summary);
  assert.equal(result.get('compteA').ig, 400);
});

test('computeGrowth24h : compte absent de l\'historique précédent est ignoré (nouveau compte, pas de baseline)', () => {
  const history = [{ date: dateKey(2), accounts: [{ account: 'autreCompte', ig: 10, tt: 0, yt: 0 }] }];
  const summary = [{ account: 'compteA', ig: 50, tt: 0, yt: 0 }];

  const result = computeGrowth24h(history, summary);
  assert.equal(result.has('compteA'), false);
});

test('computeGrowth24h : historique vide -> map vide', () => {
  const result = computeGrowth24h([], [{ account: 'compteA', ig: 50, tt: 0, yt: 0 }]);
  assert.equal(result.size, 0);
});

test('detectStuckAccounts : détecte un échec sur 3 collectes consécutives (minDays=3)', () => {
  const errorEntry = { account: 'compteA', errors: [{ platform: 'ig', message: 'Cookie expiré' }] };
  const history = [
    { date: dateKey(2), accounts: [errorEntry] },
    { date: dateKey(1), accounts: [errorEntry] },
    { date: dateKey(0), accounts: [errorEntry] }
  ];

  const stuck = detectStuckAccounts(history, 3);
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].account, 'compteA');
  assert.equal(stuck[0].platform, 'ig');
  assert.equal(stuck[0].days, 3);
  assert.equal(stuck[0].lastMessage, 'Cookie expiré');
});

test('detectStuckAccounts : pas d\'alerte avant le seuil (2 échecs sur 3, minDays=3)', () => {
  const withError = { account: 'compteA', errors: [{ platform: 'ig', message: 'Cookie expiré' }] };
  const withoutError = { account: 'compteA', errors: [] };
  const history = [
    { date: dateKey(2), accounts: [withError] },
    { date: dateKey(1), accounts: [withoutError] },
    { date: dateKey(0), accounts: [withError] }
  ];

  const stuck = detectStuckAccounts(history, 3);
  assert.equal(stuck.length, 0);
});

test('detectStuckAccounts : historique plus court que minDays -> jamais d\'alerte', () => {
  const errorEntry = { account: 'compteA', errors: [{ platform: 'ig', message: 'Cookie expiré' }] };
  const history = [{ date: dateKey(0), accounts: [errorEntry] }];

  assert.equal(detectStuckAccounts(history, 3).length, 0);
});
