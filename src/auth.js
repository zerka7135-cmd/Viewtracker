import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Authentification à mot de passe unique — pas de multi-utilisateur/
// organisation (voir backup/dashboard-rewrite-27-08 pour cette version-là,
// qui a besoin de Postgres) : un seul bot, un seul propriétaire. Le mot de
// passe est créé au tout premier accès au dashboard (voir
// server.js#POST /api/setup-password) plutôt que via une variable d'env à
// configurer à l'avance — plus simple à mettre en route, au prix d'une
// fenêtre de risque si quelqu'un d'autre atteint le dashboard avant vous
// juste après le déploiement : visitez-le immédiatement pour la fermer.
export const AUTH_PATH = process.env.AUTH_PATH || path.resolve('./data/auth.json');

// Secret de signature des cookies de session, généré une fois par process
// (pas persisté) : un redémarrage invalide les sessions en cours et force
// une reconnexion — sans conséquence vu la fréquence des redémarrages ici,
// et ça évite d'avoir un secret de plus à gérer/perdre.
const SESSION_SECRET = crypto.randomBytes(32);
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const COOKIE_NAME = 'vt_session';

const KEY_LENGTH = 64;
function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

async function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(plain, salt);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(plain, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hashHex] = stored.split('$');
  if (!salt || !hashHex) return false;
  const derived = await scrypt(plain, salt);
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function readAuth() {
  try {
    if (!fs.existsSync(AUTH_PATH)) return null;
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch (e) {
    console.error('Erreur de lecture du mot de passe du dashboard :', e.message);
    return null;
  }
}

// Empreinte courte du hash de mot de passe actuel, embarquée dans le
// cookie de session (voir sign/unsign ci-dessous) : changer le mot de
// passe change cette empreinte, donc invalide immédiatement toute session
// déjà émise (y compris sur d'autres appareils) sans avoir besoin d'un
// vrai store de sessions à révoquer une par une.
function authFingerprint() {
  const hash = readAuth()?.passwordHash;
  if (!hash) return 'none';
  return crypto.createHash('sha256').update(hash).digest('hex').slice(0, 16);
}

export function isPasswordSet() {
  return Boolean(readAuth()?.passwordHash);
}

/** @throws si un mot de passe existe déjà (voir changePassword pour le remplacer) ou trop court. */
export async function setInitialPassword(plain) {
  if (isPasswordSet()) throw new Error('Un mot de passe est déjà configuré');
  if (!plain || plain.length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères');
  const passwordHash = await hashPassword(plain);
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
  fs.writeFileSync(AUTH_PATH, JSON.stringify({ passwordHash }, null, 2));
}

export async function checkPassword(plain) {
  const auth = readAuth();
  if (!auth?.passwordHash) return false;
  return verifyPassword(plain, auth.passwordHash);
}

/** @throws si l'ancien mot de passe ne correspond pas, ou le nouveau trop court. */
export async function changePassword(currentPlain, newPlain) {
  const auth = readAuth();
  if (!auth?.passwordHash || !(await verifyPassword(currentPlain, auth.passwordHash))) {
    throw new Error('Mot de passe actuel incorrect');
  }
  if (!newPlain || newPlain.length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères');
  const passwordHash = await hashPassword(newPlain);
  fs.writeFileSync(AUTH_PATH, JSON.stringify({ passwordHash }, null, 2));
}

// --- Session cookie signée (HMAC) — pas de store de session, juste un
// horodatage signé : vérifier la signature suffit puisqu'il n'y a qu'un
// seul "compte" possible, pas d'identifiant utilisateur à transporter. ---

function sign(value) {
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
  return `${value}.${mac}`;
}

function unsign(signed) {
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expectedMac = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
  if (mac.length !== expectedMac.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expectedMac))) {
    return null;
  }
  return value;
}

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    result[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return result;
}

export function setSessionCookie(req, res) {
  const signed = sign(`${Date.now()}:${authFingerprint()}`);
  res.cookie(COOKIE_NAME, signed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.get('x-forwarded-proto') === 'https',
    maxAge: SESSION_MAX_AGE_MS
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

export function isAuthenticated(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!raw) return false;
  const value = unsign(raw);
  if (!value) return false;
  const [issuedAtStr, fingerprint] = value.split(':');
  const issuedAt = Number(issuedAtStr);
  if (!issuedAt || Date.now() - issuedAt > SESSION_MAX_AGE_MS) return false;
  // Empreinte différente = mot de passe changé depuis l'émission de ce
  // cookie : session révoquée, même si sa signature reste valide.
  return fingerprint === authFingerprint();
}

// Limite grossière contre le bruteforce du mot de passe : pas de compte à
// verrouiller (un seul mot de passe pour tout le monde), donc on retarde
// plutôt qu'on bloque — 5 échecs consécutifs déclenchent un délai
// artificiel côté serveur avant chaque tentative suivante, qui grossit à
// chaque nouvel échec. Remis à zéro sur succès. En mémoire seule (pas
// persisté) : redémarrer le bot réinitialise le compteur, acceptable ici.
let consecutiveFailures = 0;
export function recordLoginFailure() {
  consecutiveFailures++;
}
export function recordLoginSuccess() {
  consecutiveFailures = 0;
}
export function loginDelayMs() {
  if (consecutiveFailures <= 3) return 0;
  return Math.min(30000, 2 ** (consecutiveFailures - 3) * 1000);
}
