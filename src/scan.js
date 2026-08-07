import { buildViewsSummary } from './instagram.js';
import { acquireLock, releaseLock } from './cache.js';
import { config } from './config.js';
import { loadHistory, appendToday, computeGrowth, detectStuckAccounts, detectRecords } from './history.js';

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

    const historyBefore = loadHistory();
    const growth = computeGrowth(historyBefore, summary, config.historyLookbackDays);
    const records = detectRecords(historyBefore, summary);

    const fmt = (v) => v === null ? 'Ban' : v;
    const fmtGrowth = (account) => {
      const g = growth.get(account);
      if (!g) return '';
      const sign = g.delta > 0 ? '+' : '';
      const percentText = g.percent !== null ? ` (${sign}${g.percent.toFixed(1)}%)` : '';
      return ` — ${sign}${g.delta}${percentText} vs il y a ${config.historyLookbackDays}j`;
    };

    console.log(`\nTerminé — ${summary.length} compte(s) traité(s) :\n`);
    for (const item of summary) {
      const warning = item.errors && item.errors.length > 0 ? ' ⚠️' : '';
      const recordBadge = records.has(item.account) ? ' 🎉 record' : '';
      console.log(`- ${item.account}${warning}${recordBadge} : ${item.total} vues (IG: ${fmt(item.ig)} | TT: ${fmt(item.tt)} | YT: ${fmt(item.yt)})${fmtGrowth(item.account)}`);
    }

    const historyAfter = appendToday(historyBefore, summary);
    const stuckAccounts = detectStuckAccounts(historyAfter, config.stuckAlertMinDays);
    if (stuckAccounts.length > 0) {
      console.log('\n🔴 Comptes bloqués depuis plusieurs collectes consécutives :');
      for (const s of stuckAccounts) {
        console.log(`- ${s.account} (${s.platform}) : ${s.days} collectes en échec — ${s.lastMessage}`);
      }
    }
  } finally {
    releaseLock();
  }
})();
