import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Authentification multi-utilisateur — une adresse e-mail + mot de passe
// par personne (voir data/auth.json : { users: [{ email, passwordHash,
// createdAt }] }), pas de rôles/permissions différenciés (tout utilisateur
// authentifié a accès à tout, y compris changer les identifiants du bot) :
// la distinction utile ici est "peut se connecter" / "ne peut pas", pas
// "admin" vs "membre". L'e-mail sert uniquement d'identifiant de
// connexion — aucun mail n'est jamais envoyé (pas de vérification
// d'adresse, pas de réinitialisation par e-mail). Le tout premier compte
// est créé au tout premier accès au dashboard (voir
// server.js#POST /api/setup-account) ; les suivants sont ajoutés depuis
// Paramètres > Compte par quelqu'un déjà connecté (voir addUser
// ci-dessous) — pas d'auto-inscription publique.
export const AUTH_PATH = process.env.AUTH_PATH || path.resolve('./data/auth.json');

// Secret de signature des cookies de session, généré une fois par process
// (pas persisté) : un redémarrage invalide les sessions en cours et force
// une reconnexion — sans conséquence vu la fréquence des redémarrages ici,
// et ça évite d'avoir un secret de plus à gérer/perdre.
const SESSION_SECRET = crypto.randomBytes(32);
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const COOKIE_NAME = 'vt_session';
// Volontairement simple (pas de vérification RFC 5322 complète, juste
// "quelque chose@quelque chose.quelque chose") : suffisant pour rejeter
// une saisie clairement invalide, sans faux négatif sur une adresse réelle
// un peu inhabituelle. Aucun mail de confirmation n'est envoyé — l'adresse
// sert d'identifiant de connexion, pas de canal de vérification.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    if (!fs.existsSync(AUTH_PATH)) return { users: [] };
    const data = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    return { users: Array.isArray(data.users) ? data.users : [] };
  } catch (e) {
    console.error('Erreur de lecture des comptes du dashboard :', e.message);
    return { users: [] };
  }
}

function writeAuth(auth) {
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
  fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2));
}

function findUser(auth, email) {
  const needle = (email || '').toLowerCase();
  return auth.users.find((u) => u.email.toLowerCase() === needle) || null;
}

export function isPasswordSet() {
  return readAuth().users.length > 0;
}

export function listEmails() {
  return readAuth().users.map((u) => u.email).sort((a, b) => a.localeCompare(b));
}

function validateCredentials(email, plain) {
  if (!EMAIL_RE.test(email || '')) {
    throw new Error('Adresse e-mail invalide');
  }
  if (!plain || plain.length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères');
}

/** @throws si un compte existe déjà (voir addUser pour ajouter les suivants) ou identifiants invalides. */
export async function setInitialPassword(email, plain) {
  if (isPasswordSet()) throw new Error('Un compte est déjà configuré');
  validateCredentials(email, plain);
  const passwordHash = await hashPassword(plain);
  writeAuth({ users: [{ email: email.trim().toLowerCase(), passwordHash, createdAt: new Date().toISOString() }] });
}

/** @throws si l'adresse est déjà prise ou les identifiants invalides. Appelant déjà authentifié (voir server.js). */
export async function addUser(email, plain) {
  const auth = readAuth();
  validateCredentials(email, plain);
  if (findUser(auth, email)) throw new Error('Cette adresse e-mail est déjà utilisée');
  const passwordHash = await hashPassword(plain);
  auth.users.push({ email: email.trim().toLowerCase(), passwordHash, createdAt: new Date().toISOString() });
  writeAuth(auth);
}

/**
 * @throws si c'est le dernier compte restant (jamais se retrouver sans
 * aucun moyen de se reconnecter) ou si le compte n'existe pas.
 */
export function removeUser(email) {
  const auth = readAuth();
  if (auth.users.length <= 1) throw new Error('Impossible de supprimer le dernier compte restant');
  if (!findUser(auth, email)) throw new Error('Compte introuvable');
  auth.users = auth.users.filter((u) => u.email.toLowerCase() !== email.toLowerCase());
  writeAuth(auth);
}

export async function checkPassword(email, plain) {
  const user = findUser(readAuth(), email);
  if (!user) return false;
  return verifyPassword(plain, user.passwordHash);
}

/** @throws si l'ancien mot de passe ne correspond pas, ou le nouveau trop court. */
export async function changePassword(email, currentPlain, newPlain) {
  const auth = readAuth();
  const user = findUser(auth, email);
  if (!user || !(await verifyPassword(currentPlain, user.passwordHash))) {
    throw new Error('Mot de passe actuel incorrect');
  }
  if (!newPlain || newPlain.length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères');
  user.passwordHash = await hashPassword(newPlain);
  writeAuth(auth);
}

// --- Session cookie signée (HMAC) — pas de store de session, juste
// l'identifiant + un horodatage + une empreinte du hash courant, signés. ---

// Empreinte courte du hash de mot de passe d'un utilisateur donné,
// embarquée dans son cookie de session (voir sign/unsign ci-dessous) :
// changer son mot de passe change cette empreinte, donc invalide
// immédiatement toute session déjà émise pour CE compte (y compris sur
// d'autres appareils), sans toucher aux sessions des autres comptes.
function userFingerprint(user) {
  if (!user) return 'none';
  return crypto.createHash('sha256').update(`${user.email}:${user.passwordHash}`).digest('hex').slice(0, 16);
}

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

export function setSessionCookie(req, res, email) {
  const user = findUser(readAuth(), email);
  const signed = sign(`${email}:${Date.now()}:${userFingerprint(user)}`);
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

/** @returns {string|null} l'identifiant de la session valide, ou null. */
export function getSessionEmail(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!raw) return null;
  const value = unsign(raw);
  if (!value) return null;
  const [email, issuedAtStr, fingerprint] = value.split(':');
  const issuedAt = Number(issuedAtStr);
  if (!email || !issuedAt || Date.now() - issuedAt > SESSION_MAX_AGE_MS) return null;
  const user = findUser(readAuth(), email);
  // Empreinte différente = mot de passe changé (ou compte supprimé) depuis
  // l'émission de ce cookie : session révoquée, même si sa signature reste
  // valide.
  if (!user || fingerprint !== userFingerprint(user)) return null;
  return user.email;
}

export function isAuthenticated(req) {
  return getSessionEmail(req) !== null;
}

// Limite grossière contre le bruteforce du mot de passe : pas de compte à
// verrouiller (n'importe quel identifiant peut être tenté), donc on
// retarde plutôt qu'on bloque — au-delà de 3 échecs consécutifs *pour une
// IP donnée* (quel que soit l'identifiant tenté), un délai artificiel
// s'ajoute avant chaque tentative suivante de cette même IP, qui grossit à
// chaque nouvel échec. Remis à zéro sur succès. Par IP (et non global) :
// sinon un seul acharné ralentirait aussi une connexion légitime. En
// mémoire seule (pas persisté) : redémarrer le bot réinitialise les
// compteurs, acceptable ici (Railway redémarre rarement en pleine
// tentative de bruteforce).
const failuresByIp = new Map(); // ip -> { count, lastAt, alerted }
const FAILURE_ENTRY_TTL_MS = 60 * 60 * 1000; // 1h d'inactivité avant purge
const ALERT_THRESHOLD = 5;

function pruneStaleEntries() {
  const now = Date.now();
  for (const [ip, entry] of failuresByIp) {
    if (now - entry.lastAt > FAILURE_ENTRY_TTL_MS) failuresByIp.delete(ip);
  }
}

export function recordLoginFailure(ip) {
  pruneStaleEntries();
  const entry = failuresByIp.get(ip) || { count: 0, lastAt: 0, alerted: false };
  entry.count++;
  entry.lastAt = Date.now();
  failuresByIp.set(ip, entry);
}

export function recordLoginSuccess(ip) {
  failuresByIp.delete(ip);
}

export function loginDelayMs(ip) {
  const entry = failuresByIp.get(ip);
  if (!entry || entry.count <= 3) return 0;
  return Math.min(30000, 2 ** (entry.count - 3) * 1000);
}

/**
 * true une seule fois par "série" d'échecs (pas à chaque tentative
 * au-delà du seuil) dès qu'une IP atteint ALERT_THRESHOLD échecs
 * consécutifs — sert à déclencher un MP Discord à l'owner sans le
 * spammer à chaque nouvelle tentative. Remis à zéro par
 * recordLoginSuccess (nouvelle série possible après une connexion
 * réussie, ou après la purge d'inactivité).
 */
export function shouldAlertOwner(ip) {
  const entry = failuresByIp.get(ip);
  if (!entry || entry.count < ALERT_THRESHOLD || entry.alerted) return false;
  entry.alerted = true;
  return true;
}
