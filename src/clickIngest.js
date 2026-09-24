import crypto from 'crypto';

// Validation de ce que la source de clics envoie à POST /api/ingest/clicks
// (voir server.js). Fonctions pures, sans accès disque : testables seules
// (test/clickIngest.test.js).
//
// Format attendu :
//   { "source": "bitly",                    // optionnel, "api" par défaut
//     "entries": [
//       { "account": "protow", "date": "2026-09-24", "clicks": 132, "forms": 7, "cash": 49.9 },
//       { "account": "dj3b04", "date": "2026-09-24", "clicks": 41, "source": "linktree" }
//     ] }
// Trois valeurs possibles par entrée, toutes optionnelles mais au moins une :
//   clicks : clics du jour            forms : formulaires remplis (opt-ins)
//   cash   : € encaissés (décimal)
// Ce sont les totaux du jour pour ce compte et cette source : renvoyer la
// même date remplace la valeur (voir clicksStore.js#upsertClicks), et un
// champ absent laisse la valeur déjà enregistrée intacte.

export const MAX_ENTRIES = 500;
const MAX_CLICKS = 1_000_000_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_RE = /^[\w.-]{1,40}$/;

const isCount = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_CLICKS;
// Montant en euros : nombre fini positif, 2 décimales au plus (pas de
// fraction de centime à arrondir en silence).
const isEuros = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_CLICKS
  && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Compare la clé fournie (en-tête `Authorization: Bearer <clé>`) à la clé
 * attendue (variable CLICKS_API_KEY), sans fuite de timing. Une clé attendue
 * vide n'autorise jamais personne : l'ingestion est désactivée tant qu'elle
 * n'est pas configurée.
 */
export function isValidApiKey(authorizationHeader, expectedKey) {
  if (!expectedKey) return false;
  const match = /^Bearer (.+)$/.exec(authorizationHeader || '');
  if (!match) return false;

  // Hash des deux côtés : timingSafeEqual exige des longueurs identiques.
  const provided = crypto.createHash('sha256').update(match[1]).digest();
  const expected = crypto.createHash('sha256').update(expectedKey).digest();
  return crypto.timingSafeEqual(provided, expected);
}

/**
 * @param {unknown} body Corps JSON reçu
 * @param {string[]} knownAccounts Noms des comptes suivis (exacts)
 * @param {string} today YYYY-MM-DD (fuseau du bot) : une date future est refusée
 * @returns {{error?: string, valid: Array, rejected: Array<{index: number, reason: string}>}}
 */
export function parseClickEntries(body, knownAccounts, today) {
  if (!body || !Array.isArray(body.entries)) {
    return { error: 'Corps invalide : { "entries": [...] } attendu', valid: [], rejected: [] };
  }
  if (body.entries.length === 0) {
    return { error: 'Aucune entrée à enregistrer', valid: [], rejected: [] };
  }
  if (body.entries.length > MAX_ENTRIES) {
    return { error: `Trop d'entrées (${body.entries.length}) : ${MAX_ENTRIES} maximum par envoi`, valid: [], rejected: [] };
  }

  const known = new Set(knownAccounts);
  const defaultSource = body.source ?? 'api';
  const valid = [];
  const rejected = [];

  body.entries.forEach((entry, index) => {
    const reject = (reason) => rejected.push({ index, reason });

    if (!entry || typeof entry !== 'object') return reject('entrée invalide');
    if (typeof entry.account !== 'string' || !known.has(entry.account)) {
      return reject(`compte inconnu : ${JSON.stringify(entry.account)}`);
    }
    if (typeof entry.date !== 'string' || !isRealDate(entry.date)) {
      return reject('date invalide (YYYY-MM-DD attendu)');
    }
    if (entry.date > today) return reject('date dans le futur');
    const hasClicks = entry.clicks !== undefined;
    const hasForms = entry.forms !== undefined;
    const hasCash = entry.cash !== undefined;
    if (!hasClicks && !hasForms && !hasCash) return reject('au moins un champ parmi clicks, forms, cash');
    if (hasClicks && !isCount(entry.clicks)) return reject('clicks doit être un entier positif');
    if (hasForms && !isCount(entry.forms)) return reject('forms doit être un entier positif');
    if (hasCash && !isEuros(entry.cash)) return reject('cash doit être un montant en euros positif (2 décimales max)');
    const source = entry.source ?? defaultSource;
    if (typeof source !== 'string' || !SOURCE_RE.test(source)) {
      return reject('source invalide (lettres, chiffres, . _ - ; 40 caractères max)');
    }

    valid.push({
      account: entry.account,
      date: entry.date,
      source,
      clicks: hasClicks ? entry.clicks : null,
      forms: hasForms ? entry.forms : null,
      cashCents: hasCash ? Math.round(entry.cash * 100) : null
    });
  });

  return { valid, rejected };
}
