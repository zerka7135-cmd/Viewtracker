// Rate-limit générique par IP pour les routes API — jusqu'ici, seul
// POST /api/login avait une protection (voir auth.js#loginDelayMs). Toutes
// les autres routes authentifiées (accounts, settings, bot-config...)
// n'avaient aucune limite : un compte compromis (ou un bug côté client en
// boucle) pouvait les spammer sans retenue. Fenêtre glissante simple, en
// mémoire seule (pas persisté, redémarrer réinitialise les compteurs —
// acceptable ici).
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 300; // large marge au-dessus de l'usage normal (poll toutes les 4s, etc.)

const hitsByIp = new Map(); // ip -> { count, windowStart }

function pruneStale() {
  const now = Date.now();
  for (const [ip, entry] of hitsByIp) {
    if (now - entry.windowStart > WINDOW_MS) hitsByIp.delete(ip);
  }
}

/**
 * Middleware Express — à monter sur /api (après l'auth). 429 avec un
 * `Retry-After` si l'IP dépasse MAX_REQUESTS_PER_WINDOW requêtes sur la
 * fenêtre glissante en cours.
 */
export function apiRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  let entry = hitsByIp.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    hitsByIp.set(ip, entry);
  }
  entry.count++;

  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSec = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({ error: 'Trop de requêtes, réessaie dans un instant' });
  }

  // Purge occasionnelle plutôt qu'à chaque requête — pas critique, le Map
  // reste petit (une entrée par IP active dans la dernière minute).
  if (Math.random() < 0.01) pruneStale();

  next();
}
