import { buildViewsSummary } from './instagram.js';
import { acquireLock, releaseLock } from './cache.js';
import { pushViewsToSupabase } from './supabaseViews.js';
import { loadHistory, appendToday, computeGrowth24h, detectStuckAccounts, detectDecliningAccounts } from './history.js';
import { loadCumulativeViews, updateCumulativeViews, saveCumulativeViews } from './cumulativeViews.js';
import { loadAccounts } from './accountsStore.js';
import { loadSettings } from './settingsStore.js';

// Lance une collecte complète immédiatement et affiche le résultat dans le
// terminal, sans passer par Discord. Utile pour tester le scraping.
(async () => {
  if (!acquireLock()) {
    console.error('Une collecte est déjà en cours (cron ou autre scan manuel). Abandon.');
    process.exit(1);
  }

  try {
    console.log('Lancement de la collecte manuelle...');
    const settings = loadSettings();
    const summary = await buildViewsSummary(loadAccounts(), settings.postsLimit);

    const historyBefore = loadHistory();
    const growth24h = computeGrowth24h(historyBefore, summary);

    const cumulativeBefore = loadCumulativeViews();
    const cumulativeAfter = updateCumulativeViews(cumulativeBefore, growth24h, summary);
    saveCumulativeViews(cumulativeAfter);

    const fmt = (v) => v === null ? 'Ban' : v;

    // null = pas de compte sur cette plateforme (Ban) ; un vrai 0 sur une
    // plateforme configurée est suspect, marqué ⚠️ plutôt que confondu avec Ban.
    const rawByAccount = new Map(summary.map(item => [item.account, item]));
    const fmtComputed = (account, platform, computedValue) => {
      const raw = rawByAccount.get(account)?.[platform];
      if (raw === null) return 'Ban';
      return computedValue === 0 ? `⚠️ 0` : computedValue;
    };

    console.log(`\nTerminé — ${summary.length} compte(s) traité(s) :\n`);
    for (const item of summary) {
      const warning = item.errors && item.errors.length > 0 ? ' ⚠️' : '';
      console.log(`- ${item.account}${warning} : ${item.total} vues (IG: ${fmt(item.ig)} | TT: ${fmt(item.tt)} | YT: ${fmt(item.yt)})`);
    }

    console.log('\n🔥 Classement dernières 24h :\n');
    if (growth24h.size === 0) {
      console.log("(pas encore assez d'historique pour calculer un gain sur 24h)");
    } else {
      const growth24hSorted = [...growth24h.entries()].sort((a, b) => b[1].total - a[1].total);
      for (const [account, g] of growth24hSorted) {
        console.log(`- ${account} : ${g.total} vues (IG: ${fmtComputed(account, 'ig', g.ig)} | TT: ${fmtComputed(account, 'tt', g.tt)} | YT: ${fmtComputed(account, 'yt', g.yt)})`);
      }
    }

    console.log('\n♾️  Classement all time :\n');
    const allTimeSorted = Object.entries(cumulativeAfter).sort((a, b) => b[1].total - a[1].total);
    for (const [account, v] of allTimeSorted) {
      console.log(`- ${account} : ${v.total} vues (IG: ${fmtComputed(account, 'ig', v.ig)} | TT: ${fmtComputed(account, 'tt', v.tt)} | YT: ${fmtComputed(account, 'yt', v.yt)})`);
    }

    const historyAfter = appendToday(historyBefore, summary);
    await pushViewsToSupabase();
    const stuckAccounts = detectStuckAccounts(historyAfter, settings.stuckAlertMinDays);
    if (stuckAccounts.length > 0) {
      console.log('\n🔴 Comptes bloqués depuis plusieurs collectes consécutives :');
      for (const s of stuckAccounts) {
        console.log(`- ${s.account} (${s.platform}) : ${s.days} collectes en échec — ${s.lastMessage}`);
      }
    }

    const decliningAccounts = detectDecliningAccounts(historyAfter);
    if (decliningAccounts.length > 0) {
      console.log('\n📉 Baisse d\'audience détectée :');
      for (const d of decliningAccounts) {
        console.log(`- ${d.account} : ${d.avgRecent} vues/jour récemment, contre ${d.avgBaseline} habituellement (${Math.round(d.ratio * 100)}%)`);
      }
    }
  } finally {
    releaseLock();
  }
})();
