import crypto from 'crypto';

// Hachage des mots de passe (users.password_hash, base creator_leaderboard
// partagée) via crypto.scrypt — natif à Node, pas de dépendance
// bcrypt/argon2 (qui nécessitent une compilation native). Format stocké :
// "scrypt$<sel en hex>$<hash en hex>", la colonne `password_hash` étant un
// simple `text` sans format imposé par le schéma existant.

const KEY_LENGTH = 64;

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** @returns {Promise<string>} */
export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(plain, salt);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

/** @returns {Promise<boolean>} */
export async function verifyPassword(plain, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hashHex] = stored.split('$');
  if (!salt || !hashHex) return false;

  const derived = await scrypt(plain, salt);
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;

  return crypto.timingSafeEqual(derived, expected);
}
