import { buildViewsSummary } from './instagram.js';
import { acquireLock, releaseLock } from './cache.js';

// Lance une collecte complète immédiatement et affiche le résultat dans le
// terminal, sans passer par Discord. Utile pour tester le scraping.
(async () => {
  if (!acquireLock()) {
    console.error('Une collecte est déjà en cours (cron ou autre scan manuel). Abandon.');
    process.exit(1);
  }

  try {
    console.log('Lancement de la collecte manuelle...');
    const summary = await buildViewsSummary();

    const fmt = (v) => v === null ? 'Ban' : v;

    console.log(`\nTerminé — ${summary.length} compte(s) traité(s) :\n`);
    for (const item of summary) {
      const warning = item.errors && item.errors.length > 0 ? ' ⚠️' : '';
      console.log(`- ${item.account}${warning} : ${item.total} vues (IG: ${fmt(item.ig)} | TT: ${fmt(item.tt)} | YT: ${fmt(item.yt)})`);
    }
  } finally {
    releaseLock();
  }
})();
