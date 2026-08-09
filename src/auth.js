import crypto from 'crypto';
import { query, withTransaction } from './db.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { config } from './config.js';
import { sendEmail } from './email.js';

// Login par utilisateur (email + mot de passe), branché sur les tables
// `users`/`memberships` déjà présentes dans la base Postgres partagée
// (creator_leaderboard). En plus du bootstrap CLI (scripts/create-user.js,
// qui rattache à l'organisation par défaut du bot), l'inscription publique
// (voir signupUser ci-dessous) crée une organisation neuve et isolée par
// utilisateur — personne ne peut rejoindre "Mon Serveur" (les vraies
// données) juste en s'inscrivant.
//
// Le secret de signature du cookie est généré aléatoirement à chaque
// démarrage du process (comme au chantier précédent) : les sessions
// n'survivent pas à un redéploiement, acceptable pour l'usage actuel.
const SESSION_SECRET = crypto.randomBytes(32);
const SESSION_COOKIE = 'vt_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expectedMac = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');

  if (mac.length !== expectedMac.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expectedMac))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((pair) => {
      const idx = pair.indexOf('=');
      return [pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1).trim())];
    })
  );
}

/**
 * Vérifie email + mot de passe contre `users`, résout la première
 * organisation de l'utilisateur via `memberships` (un seul membership
 * utilisé pour l'instant, voir plan — pas de sélecteur d'org).
 * @returns {Promise<{userId: string, email: string, orgId: string, orgName: string, role: string} | null>}
 */
export async function authenticateUser(email, password) {
  if (!email || !password) return null;

  const { rows } = await query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
  if (rows.length === 0) return null;

  const user = rows[0];
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;

  const membership = await query(
    `SELECT m.organization_id, m.role, o.name AS org_name, o.onboarding_completed
     FROM memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1
     ORDER BY m.created_at ASC
     LIMIT 1`,
    [user.id]
  );
  if (membership.rows.length === 0) return null; // utilisateur sans organisation : accès refusé plutôt qu'un dashboard vide

  const m = membership.rows[0];
  return {
    userId: user.id,
    email: user.email,
    orgId: m.organization_id,
    orgName: m.org_name,
    role: m.role,
    onboardingCompleted: m.onboarding_completed
  };
}

const MIN_PASSWORD_LENGTH = 8;

/**
 * Inscription publique : crée l'utilisateur **et** une organisation neuve,
 * vide, dont il est owner (voir plan — jamais un accès direct à une
 * organisation existante). `onboarding_completed=false` sur cette
 * nouvelle organisation : le dashboard affichera l'onboarding (voir
 * OnboardingScreen.jsx / POST /api/onboarding/complete) tant qu'aucun
 * compte n'a été ajouté. Échoue si l'email est déjà pris.
 * @returns {Promise<{userId: string, email: string, orgId: string, orgName: string, role: string, onboardingCompleted: boolean}>}
 */
export async function signupUser(email, password) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Adresse email invalide');
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères`);
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new Error('Un compte existe déjà avec cet email');
  }

  const passwordHash = await hashPassword(password);
  const orgName = `Espace de ${email.split('@')[0]}`;

  return withTransaction(async (client) => {
    const userRes = await client.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
      [email, passwordHash]
    );
    const userId = userRes.rows[0].id;

    const orgRes = await client.query(
      "INSERT INTO organizations (name, type, onboarding_completed) VALUES ($1, 'b2c', false) RETURNING id",
      [orgName]
    );
    const orgId = orgRes.rows[0].id;

    await client.query(
      "INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'owner')",
      [userId, orgId]
    );

    return { userId, email, orgId, orgName, role: 'owner', onboardingCompleted: false };
  });
}

/** Marque l'onboarding terminé pour une organisation (voir POST /api/onboarding/complete). */
export async function completeOnboarding(orgId) {
  await query('UPDATE organizations SET onboarding_completed = true WHERE id = $1', [orgId]);
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Demande de réinitialisation de mot de passe : génère un token à usage
 * unique (seul son hash est stocké, voir migrations/005_password_reset.sql),
 * envoie l'email via Resend (src/email.js). Ne lève jamais d'erreur pour un
 * email inconnu — reste silencieux côté appelant (voir POST
 * /api/forgot-password) pour ne pas révéler quels emails ont un compte.
 * Les erreurs d'envoi (ex. RESEND_API_KEY manquant) sont loguées côté
 * serveur mais n'échouent pas la requête HTTP.
 */
export async function requestPasswordReset(email) {
  if (!email) return;

  const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (rows.length === 0) return; // email inconnu : silencieux, pas d'énumération de comptes

  const userId = rows[0].id;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hashToken(token), expiresAt]
  );

  const resetUrl = `${config.publicUrl}/?resetToken=${token}`;
  try {
    await sendEmail({
      to: email,
      subject: 'Réinitialisation de votre mot de passe ViewTracker',
      html: `
        <p>Une réinitialisation de mot de passe a été demandée pour ce compte.</p>
        <p><a href="${resetUrl}">Choisir un nouveau mot de passe</a> (lien valable 1 heure).</p>
        <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      `
    });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email de réinitialisation :', error.message);
  }
}

/**
 * Valide un token de réinitialisation et met à jour le mot de passe.
 * Le token est marqué utilisé (used_at) dans la foulée — usage unique.
 */
export async function resetPassword(token, newPassword) {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères`);
  }

  const { rows } = await query(
    `SELECT id, user_id FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hashToken(token)]
  );
  if (rows.length === 0) {
    throw new Error('Lien de réinitialisation invalide ou expiré');
  }

  const { id, user_id: userId } = rows[0];
  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [id]);
  });
}

/**
 * Change le mot de passe d'un utilisateur connecté (vérifie l'ancien avant
 * d'appliquer le nouveau) — voir PATCH /api/account/password.
 */
export async function changePassword(userId, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères`);
  }

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (rows.length === 0) throw new Error('Utilisateur introuvable');

  const valid = await verifyPassword(currentPassword || '', rows[0].password_hash);
  if (!valid) throw new Error('Mot de passe actuel incorrect');

  const passwordHash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

const INVITABLE_ROLES = ['manager', 'clipper', 'viewer']; // owner exclu — contrainte déjà imposée par invitations_role_check en base

/**
 * Liste les membres actifs (memberships) et les invitations en attente
 * d'une organisation — voir GET /api/members.
 */
export async function listMembers(orgId) {
  const members = await query(
    `SELECT m.id, m.role, m.created_at, u.email
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = $1
     ORDER BY m.created_at ASC`,
    [orgId]
  );
  const pending = await query(
    `SELECT id, email, role, created_at
     FROM invitations
     WHERE organization_id = $1 AND accepted_at IS NULL
     ORDER BY created_at ASC`,
    [orgId]
  );
  return { members: members.rows, pendingInvitations: pending.rows };
}

/**
 * Invite un membre par email. Si l'email a déjà un compte, l'ajoute
 * directement à l'organisation (pas d'email nécessaire — il verra
 * l'organisation à sa prochaine connexion, voir plan). Sinon, crée une
 * invitation et envoie un email avec un lien d'acceptation
 * (`?inviteId=...`, voir acceptInvitation ci-dessous).
 */
export async function inviteMember(orgId, invitedByUserId, email, role) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Adresse email invalide');
  }
  if (!INVITABLE_ROLES.includes(role)) {
    throw new Error('Rôle invalide');
  }

  const existingUser = await query('SELECT id FROM users WHERE email = $1', [email]);

  if (existingUser.rows.length > 0) {
    const userId = existingUser.rows[0].id;
    const already = await query('SELECT id FROM memberships WHERE user_id = $1 AND organization_id = $2', [userId, orgId]);
    if (already.rows.length > 0) throw new Error('Cette personne fait déjà partie de l\'organisation');

    await query('INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)', [userId, orgId, role]);
    return { status: 'added' };
  }

  const existingInvite = await query(
    'SELECT id FROM invitations WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL',
    [orgId, email]
  );
  if (existingInvite.rows.length > 0) throw new Error('Une invitation est déjà en attente pour cet email');

  const inviteRes = await query(
    'INSERT INTO invitations (organization_id, email, role, invited_by_user_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [orgId, email, role, invitedByUserId]
  );
  const inviteId = inviteRes.rows[0].id;

  const acceptUrl = `${config.publicUrl}/?inviteId=${inviteId}`;
  try {
    await sendEmail({
      to: email,
      subject: 'Invitation à rejoindre une organisation sur ViewTracker',
      html: `
        <p>Vous avez été invité(e) à rejoindre une organisation sur ViewTracker (rôle : ${role}).</p>
        <p><a href="${acceptUrl}">Accepter l'invitation</a> et créer votre compte.</p>
      `
    });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email d\'invitation :', error.message);
  }

  return { status: 'invited' };
}

/**
 * Accepte une invitation en attente : crée l'utilisateur (l'email n'a par
 * définition pas encore de compte, voir inviteMember) et le membership au
 * rôle invité, marque l'invitation acceptée.
 * @returns {Promise<{userId: string, email: string, orgId: string, orgName: string, role: string, onboardingCompleted: boolean}>}
 */
export async function acceptInvitation(inviteId, password) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères`);
  }

  const { rows } = await query(
    `SELECT i.email, i.role, i.organization_id, o.name AS org_name, o.onboarding_completed
     FROM invitations i JOIN organizations o ON o.id = i.organization_id
     WHERE i.id = $1 AND i.accepted_at IS NULL`,
    [inviteId]
  );
  if (rows.length === 0) throw new Error('Invitation invalide ou déjà utilisée');

  const invite = rows[0];
  const existingUser = await query('SELECT id FROM users WHERE email = $1', [invite.email]);
  if (existingUser.rows.length > 0) {
    throw new Error('Un compte existe déjà avec cet email — connectez-vous normalement.');
  }

  const passwordHash = await hashPassword(password);

  return withTransaction(async (client) => {
    const userRes = await client.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [invite.email, passwordHash]);
    const userId = userRes.rows[0].id;

    await client.query('INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)', [userId, invite.organization_id, invite.role]);
    await client.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [inviteId]);

    return {
      userId,
      email: invite.email,
      orgId: invite.organization_id,
      orgName: invite.org_name,
      role: invite.role,
      onboardingCompleted: invite.onboarding_completed
    };
  });
}

/**
 * Retire un membre d'une organisation (voir DELETE /api/members/:id) —
 * réservé au rôle owner côté route. Refuse de retirer le dernier owner
 * pour ne jamais laisser une organisation sans propriétaire.
 */
export async function removeMember(orgId, membershipId) {
  const { rows } = await query('SELECT role FROM memberships WHERE id = $1 AND organization_id = $2', [membershipId, orgId]);
  if (rows.length === 0) throw new Error('Membre introuvable');

  if (rows[0].role === 'owner') {
    const owners = await query("SELECT count(*) FROM memberships WHERE organization_id = $1 AND role = 'owner'", [orgId]);
    if (Number(owners.rows[0].count) <= 1) {
      throw new Error('Impossible de retirer le dernier propriétaire de l\'organisation');
    }
  }

  await query('DELETE FROM memberships WHERE id = $1 AND organization_id = $2', [membershipId, orgId]);
}

// email/orgName/role sont inclus dans le cookie signé lui-même (pas
// seulement userId/orgId) : évite une requête DB supplémentaire à chaque
// GET /api/me, au prix de valeurs figées à l'instant du login jusqu'à la
// prochaine reconnexion (acceptable — un changement de rôle/nom d'org en
// cours de session n'a pas besoin d'être instantané ici).
export function setSessionCookie(res, session) {
  const token = sign({
    userId: session.userId,
    orgId: session.orgId,
    email: session.email,
    orgName: session.orgName,
    role: session.role,
    onboardingCompleted: session.onboardingCompleted,
    exp: Date.now() + SESSION_TTL_MS
  });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/** @returns {{userId: string, orgId: string, email: string, orgName: string, role: string} | null} */
function getSession(req) {
  const cookies = parseCookies(req);
  return verify(cookies[SESSION_COOKIE]);
}

/** Utilisé par GET /api/me pour afficher qui est connecté (email, org, rôle). */
export function getSessionInfo(req) {
  return getSession(req);
}

export function isAuthenticated(req) {
  return getSession(req) !== null;
}

/**
 * Middleware Express : protège toutes les routes /api/* sauf /api/login.
 * Pose `req.userId`/`req.orgId` à partir du cookie de session — plus de
 * résolution d'organisation globale au démarrage du serveur (voir
 * src/server.js), chaque requête porte celle de l'utilisateur connecté.
 */
export function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Authentification requise' });

  req.userId = session.userId;
  req.orgId = session.orgId;
  req.role = session.role;
  next();
}

/** Middleware : restreint une route aux rôles listés (voir server.js). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.role)) {
      return res.status(403).json({ error: 'Action réservée à ' + roles.join('/') });
    }
    next();
  };
}
