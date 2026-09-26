import { syncAccountsFromApp } from '../src/accountsSync.js';

// npm run accounts-sync            -> simulation : affiche les changements sans rien appliquer
// npm run accounts-sync -- --apply -> applique les changements
const apply = process.argv.includes('--apply');
const result = await syncAccountsFromApp({ dryRun: !apply });
if (result.plan) {
  const p = result.plan;
  console.log(`${result.clippers} clipper(s) avec au moins un réseau dans l'app.`);
  for (const a of p.add) console.log(`+ ajout       ${a.name}  ${a.urls.filter(Boolean).join(' ')}`);
  for (const r of p.rename) console.log(`~ renommage   ${r.from} -> ${r.to}`);
  for (const u of p.update) console.log(`~ pseudos     ${u.name}  ${u.urls.filter(Boolean).join(' ')}`);
  for (const n of p.remove) console.log(`- retrait     ${n} (données conservées)`);
  for (const l of p.link) console.log(`= lien        ${l.name} -> ${l.clipperId}`);
  for (const s of p.skipped) console.log(`! ignoré      ${s}`);
}
console.log(result.message);
process.exitCode = result.ok ? 0 : 1;
