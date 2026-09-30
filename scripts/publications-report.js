import { getPublicationsPerDay, loadPublicationsLog } from '../src/publicationsLog.js';

// npm run publications-report [-- --account=nomDuCompte] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
// Affiche le nombre de publications par jour à partir du journal (voir
// README, "Journal des publications") : fiable comme minimum pour
// TikTok/Instagram (date réelle décodée), approximatif pour YouTube (jour de
// première apparition, pas la vraie date de publication).
const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('='))
);

const log = loadPublicationsLog();
console.log(`${log.length} publication(s) au total dans le journal.`);

const { tt_ig: ttIg, yt } = getPublicationsPerDay(args);

const printTable = (title, data) => {
  console.log(`\n${title}`);
  const days = Object.keys(data).sort();
  if (!days.length) { console.log('  (aucune donnée)'); return; }
  for (const day of days) console.log(`  ${day} : ${data[day]}`);
  console.log(`  Total : ${days.reduce((s, d) => s + data[d], 0)}`);
};

printTable('TikTok + Instagram (jour réel de publication — minimum fiable)', ttIg);
printTable('YouTube (jour de première apparition — approximatif)', yt);
