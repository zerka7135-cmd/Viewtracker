import { runMigrations, query } from '../src/db.js';
import { getDefaultOrgId } from '../src/org.js';
import { hashPassword } from '../src/passwords.js';

// Bootstrap CLI pour créer/mettre à jour un utilisateur du dashboard —
// pas d'inscription publique (voir README, section Auth) : c'est le seul
// moyen de créer un compte pour l'instant.
//
// Usage :
//   node scripts/create-user.js email@example.com motdepasse
//   CREATE_USER_PASSWORD=motdepasse node scripts/create-user.js email@example.com
//
// Le mot de passe en argument reste dans l'historique du shell — préférez
// la variable d'env CREATE_USER_PASSWORD si c'est un souci pour vous.
// Idempotent : relancer avec le même email met juste à jour le mot de
// passe (et crée le membership manquant si besoin) plutôt que d'échouer.

const email = process.argv[2];
const password = process.argv[3] || process.env.CREATE_USER_PASSWORD;

if (!email || !password) {
  console.error('Usage : node scripts/create-user.js <email> [mot-de-passe]');
  console.error('        (ou CREATE_USER_PASSWORD=... node scripts/create-user.js <email>)');
  process.exit(1);
}

await runMigrations();
const orgId = await getDefaultOrgId();
const passwordHash = await hashPassword(password);

const userRes = await query(
  `INSERT INTO users (email, password_hash) VALUES ($1, $2)
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
   RETURNING id, (xmax = 0) AS inserted`,
  [email, passwordHash]
);
const userId = userRes.rows[0].id;
const wasInserted = userRes.rows[0].inserted;

const membershipRes = await query(
  `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'owner')
   ON CONFLICT (user_id, organization_id) DO NOTHING
   RETURNING id`,
  [userId, orgId]
);

console.log(`Utilisateur ${wasInserted ? 'créé' : 'mis à jour (mot de passe)'} : ${email} (id ${userId}).`);
console.log(
  membershipRes.rows.length > 0
    ? `Membership "owner" créé sur l'organisation ${orgId} ("Mon Serveur").`
    : `Membership déjà existant sur l'organisation ${orgId} — inchangé.`
);

process.exit(0);
