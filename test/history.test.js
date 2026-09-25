import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGrowth24h, detectStuckAccounts, detectDecliningAccounts } from '../src/history.js';

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

test('computeGrowth24h : vieille vidéo qui revient dans la fenêtre -> seulement les vues gagnées depuis sa dernière apparition', () => {
  const post = (id, views) => ({ id, views });
  const history = [
    { date: dateKey(10), accounts: [{ account: 'compteA', ig: 300, tt: 0, yt: 0, posts: { ig: [post('vieille', 200), post('b', 100)] } }] },
    { date: dateKey(1), accounts: [{ account: 'compteA', ig: 700, tt: 0, yt: 0, posts: { ig: [post('recente', 500), post('b', 200)] } }] }
  ];
  // 'recente' a disparu (supprimée) : 'vieille' revient avec 250 vues -> +50, pas +250.
  // 'nouvelle' n'a jamais été vue -> toutes ses vues comptent.
  const summary = [{ account: 'compteA', ig: 330, tt: 0, yt: 0, posts: { ig: [post('nouvelle', 80), post('vieille', 250)] } }];

  const result = computeGrowth24h(history, summary);
  assert.deepEqual(result.get('compteA'), { total: 130, ig: 130, tt: 0, yt: 0 });
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

// Construit un historique de `deltas.length + 1` entrées (un jour de
// référence, puis un jour par delta) pour un seul compte — daysNeeded pour
// detectDecliningAccounts(history, baselineDays, recentDays) vaut
// baselineDays + recentDays + 1, donc deltas doit faire baselineDays +
// recentDays de long pour couvrir tout juste la fenêtre.
function historyFromDeltas(deltas) {
  let total = 0;
  const totals = [total, ...deltas.map((d) => (total += d))];
  return totals.map((t, i) => ({
    date: dateKey(totals.length - 1 - i),
    accounts: [{ account: 'compteA', total: t }]
  }));
}

test('detectDecliningAccounts : détecte un rythme récent tombé sous 30% de la moyenne habituelle', () => {
  const deltas = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 100, 100, 100]; // 7 baseline, 3 récents
  const history = historyFromDeltas(deltas);

  const declining = detectDecliningAccounts(history, 7, 3);
  assert.equal(declining.length, 1);
  assert.equal(declining[0].account, 'compteA');
  assert.equal(declining[0].avgBaseline, 1000);
  assert.equal(declining[0].avgRecent, 100);
  assert.ok(declining[0].ratio < 0.3);
});

test('detectDecliningAccounts : rythme stable -> pas d\'alerte', () => {
  const deltas = new Array(10).fill(1000);
  const history = historyFromDeltas(deltas);

  assert.equal(detectDecliningAccounts(history, 7, 3).length, 0);
});

test('detectDecliningAccounts : compte déjà à l\'arrêt avant (baseline nulle) -> ignoré', () => {
  const deltas = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const history = historyFromDeltas(deltas);

  assert.equal(detectDecliningAccounts(history, 7, 3).length, 0);
});

test('detectDecliningAccounts : historique plus court que la fenêtre -> jamais d\'alerte', () => {
  const deltas = [1000, 1000, 1000, 100, 100, 100]; // trop court pour baselineDays=7 + recentDays=3
  const history = historyFromDeltas(deltas);

  assert.equal(detectDecliningAccounts(history, 7, 3).length, 0);
});

test('detectDecliningAccounts : panne de scraping (errors) dans la fenêtre -> ignoré, pas une baisse d\'audience', () => {
  // TikTok en échec les 3 derniers jours : sa part tombe à 0 dans total,
  // ce qui ressemblerait à un effondrement sans ce garde-fou.
  const deltas = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 0, 0, 0];
  const history = historyFromDeltas(deltas);
  for (const entry of history.slice(-3)) {
    entry.accounts[0].errors = [{ platform: 'TT', message: 'cookie expiré' }];
  }

  assert.equal(detectDecliningAccounts(history, 7, 3).length, 0);
});

// --- Référence de calcul après une collecte en échec ---

test('computeGrowth24h : après un jour de scraping en échec, pas de faux pic (référence = dernière collecte réussie)', () => {
  const history = [
    {
      date: dateKey(2),
      accounts: [{
        account: 'compteA', ig: 300000, tt: null, yt: null, errors: [],
        posts: { ig: [{ id: 'r1', views: 150000 }, { id: 'r2', views: 150000 }], tt: null, yt: null }
      }]
    },
    {
      // Veille : Instagram en échec (total 0, aucun post relevé).
      date: dateKey(1),
      accounts: [{
        account: 'compteA', ig: 0, tt: null, yt: null,
        errors: [{ platform: 'Instagram', message: 'Aucune vue détectée' }],
        posts: { ig: [], tt: null, yt: null }
      }]
    }
  ];
  const summary = [{
    account: 'compteA', ig: 302000, tt: null, yt: null, errors: [],
    posts: { ig: [{ id: 'r1', views: 151000 }, { id: 'r2', views: 151000 }], tt: null, yt: null }
  }];

  // Avant la correction : +302 000 (toutes les vues comptées comme "nouvelles").
  assert.deepEqual(computeGrowth24h(history, summary).get('compteA'), { total: 2000, ig: 2000, tt: 0, yt: 0 });
});

test('computeGrowth24h : plateforme sans aucune collecte réussie auparavant -> 0, pas toutes ses vues', () => {
  const history = [
    {
      date: dateKey(1),
      accounts: [{ account: 'compteA', ig: 1000, tt: null, yt: null, errors: [], posts: { ig: [{ id: 'a', views: 1000 }], tt: null, yt: null } }]
    }
  ];
  // TikTok vient d'être ajouté au compte : ses 50 000 vues existantes ne
  // sont pas un gain du jour.
  const summary = [{
    account: 'compteA', ig: 1100, tt: 50000, yt: null, errors: [],
    posts: { ig: [{ id: 'a', views: 1100 }], tt: [{ id: 't1', views: 50000 }], yt: null }
  }];

  assert.deepEqual(computeGrowth24h(history, summary).get('compteA'), { total: 100, ig: 100, tt: 0, yt: 0 });
});

test('computeGrowth24h : référence sans ID de vidéo (repli texte) -> diff des totaux, pas toutes les vues', () => {
  const history = [
    { date: dateKey(1), accounts: [{ account: 'compteA', ig: 5000, tt: null, yt: null, errors: [], posts: { ig: [], tt: null, yt: null } }] }
  ];
  const summary = [{
    account: 'compteA', ig: 5400, tt: null, yt: null, errors: [],
    posts: { ig: [{ id: 'x', views: 2700 }, { id: 'y', views: 2700 }], tt: null, yt: null }
  }];

  assert.deepEqual(computeGrowth24h(history, summary).get('compteA'), { total: 400, ig: 400, tt: 0, yt: 0 });
});
