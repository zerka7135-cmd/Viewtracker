import fs from 'fs';
import { loadHistory, computeGrowth24h } from '../src/history.js';
import { loadCumulativeViews, saveCumulativeViews, updateCumulativeViews, CUMULATIVE_PATH } from '../src/cumulativeViews.js';
import { acquireLock, releaseLock } from '../src/cache.js';

// Recalcule le cumul all-time en rejouant tout l'historique avec le calcul
// actuel (mêmes fonctions que la collecte). Les comptes absents de
// l'historique gardent leur cumul actuel.
//   npm run rebuild-cumulative            -> comparaison, rien n'est écrit
//   npm run rebuild-cumulative -- --apply -> sauvegarde l'ancien fichier puis écrit le nouveau
const apply = process.argv.includes('--apply');

const history = loadHistory();
let rebuilt = {};
history.forEach((entry, index) => {
  const growth = computeGrowth24h(history.slice(0, index), entry.accounts, entry.date);
  rebuilt = updateCumulativeViews(rebuilt, growth, entry.accounts, entry.date);
});

const current = loadCumulativeViews();
const result = { ...current, ...rebuilt };
let before = 0;
let after = 0;
for (const name of Object.keys(result)) {
  const old = current[name]?.total ?? 0;
  before += old;
  after += result[name].total;
  console.log(`${name.padEnd(20)} ${String(old).padStart(10)} -> ${String(result[name].total).padStart(10)}  (${result[name].total - old >= 0 ? '+' : ''}${result[name].total - old})`);
}
console.log(`TOTAL ${before} -> ${after} (${after - before >= 0 ? '+' : ''}${after - before}), ${history.length} collectes rejouées (${history[0]?.date} -> ${history.at(-1)?.date})`);

if (!apply) {
  console.log('Simulation : rien n\'a été écrit (ajouter --apply pour appliquer).');
} else {
  if (!acquireLock()) {
    console.error('Collecte en cours : réessaie dans quelques minutes.');
    process.exit(1);
  }
  try {
    const backup = `${CUMULATIVE_PATH}.avant-recalcul-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.copyFileSync(CUMULATIVE_PATH, backup);
    saveCumulativeViews(result);
    console.log(`Cumul recalculé et enregistré. Ancien fichier sauvegardé : ${backup}`);
  } finally {
    releaseLock();
  }
}
