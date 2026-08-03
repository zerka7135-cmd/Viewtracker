import { buildViewsSummary } from './instagram.js';
import { saveSummary, acquireLock, releaseLock } from './cache.js';

// Lance une collecte complète immédiatement et la sauvegarde dans
// data/last-summary.json, sans passer par Discord.
// Utile pour tester le scraping ou forcer une mise à jour avant
// l'heure planifiée du cron.
(async () => {
  if (!acquireLock()) {
    console.error('Une collecte est déjà en cours (cron ou autre scan manuel). Abandon.');
    process.exit(1);
  }

  try {
    console.log('Lancement de la collecte manuelle...');
    const summary = await buildViewsSummary();
    saveSummary(summary);

    console.log(`\nTerminé — ${summary.length} compte(s) traité(s) :\n`);
    for (const item of summary) {
      const warning = item.errors && item.errors.length > 0 ? ' ⚠️' : '';
      console.log(`- ${item.account}${warning} : ${item.total} vues (IG: ${item.ig} | TT: ${item.tt} | YT: ${item.yt})`);
    }
    console.log('\nRésultat sauvegardé dans data/last-summary.json. La commande /resume affichera ces données.');
  } finally {
    releaseLock();
  }
})();
