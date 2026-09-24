// Conversion des compteurs de vues affichés par Instagram/YouTube en
// nombres. Exécutée côté Node (et plus dans page.evaluate) pour pouvoir
// être testée directement — voir test/parseViews.test.js.
//
// Le scraping tourne en locale fr-FR : les plateformes y affichent
// "1,2 M de vues", "12,3 k", "1 234" (espace insécable comme séparateur de
// milliers)... en plus des formats anglais ("277K", "1.2M views"). Avant ce
// module, "1,2 M de vues" n'était pas reconnu sur YouTube : le Short le plus
// viral d'un compte était ignoré et remplacé par le suivant.

// Espaces insécables (U+00A0, U+202F) ramenés à un espace simple.
function normalizeSpaces(text) {
  return String(text ?? '').replace(/[\u00a0\u202f]/g, ' ');
}

// Nombre suivi d'un suffixe optionnel : k/K (mille), M/m (million),
// Md/Mrd/B (milliard). Un espace n'est accepté comme séparateur de
// milliers que s'il est suivi d'un groupe de 3 chiffres exactement ("1 234"),
// et jamais un retour à la ligne : un titre finissant par un chiffre
// ("Top 10 1,2 M de vues") n'est pas collé au compteur.
const NUMBER = String.raw`(\d(?:[\d.,]| (?=\d{3}(?!\d)))*)`;
const SUFFIX = String.raw`(md|mrd|[kmb])?`;

const MULTIPLIERS = { k: 1e3, m: 1e6, md: 1e9, mrd: 1e9, b: 1e9 };

function toNumber(rawNumber, rawSuffix) {
  const suffix = (rawSuffix || '').toLowerCase();
  const mult = MULTIPLIERS[suffix] || 1;
  let value = rawNumber.replace(/ /g, '');

  if (mult === 1) {
    // Sans suffixe, virgules et points sont des séparateurs de milliers
    // ("2,479" ou "2.479" = 2479 vues).
    value = value.replace(/[.,]/g, '');
  } else {
    // Avec suffixe, c'est un séparateur décimal ("1,2 M" = 1.2 million).
    value = value.replace(',', '.');
  }

  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed * mult) : 0;
}

const COUNT_ONLY_RE = new RegExp(String.raw`^${NUMBER}\s*${SUFFIX}$`, 'i');

/**
 * Compteur seul, sans mot "vues" (ex. texte d'une vignette de la grille des
 * reels Instagram : "277K", "1,2 M", "12 345").
 * @returns {number|null} null si le texte n'est pas un compteur
 */
export function parseCount(text) {
  const match = normalizeSpaces(text).trim().match(COUNT_ONLY_RE);
  return match ? toNumber(match[1], match[2]) : null;
}

const VIEWS_RE = new RegExp(String.raw`${NUMBER}[ \t]*${SUFFIX}[ \t]*(?:de[ \t]+)?(?:vues|views|plays|lectures)\b`, 'i');
const VIEWS_RE_GLOBAL = new RegExp(VIEWS_RE.source, 'gi');

/**
 * Premier "N vues" trouvé dans un texte libre (ex. "Mon short\n1,2 M de vues").
 * @returns {number} 0 si aucun compteur de vues n'est trouvé
 */
export function parseViewsText(text) {
  const match = normalizeSpaces(text).match(VIEWS_RE);
  return match ? toNumber(match[1], match[2]) : 0;
}

/** Tous les "N vues" d'un texte libre, dans l'ordre d'apparition. */
export function parseAllViewsText(text) {
  return [...normalizeSpaces(text).matchAll(VIEWS_RE_GLOBAL)].map(m => toNumber(m[1], m[2]));
}

/**
 * Convertit le relevé brut de la page Reels Instagram en vues.
 * Appelée par instagram.js#buildViewsSummary.
 * @param {{grid: Array<{href: string, text: string}>, playCounts: number[], bodyText: string}} raw
 * @returns {{total: number, counted: Array}}
 */
export function extractInstagramViews(raw, postsLimit) {
  let counted = [];

  // 1. Grille des reels (seule voie qui fournit un href, donc un ID).
  for (const { href, text } of raw.grid || []) {
    const val = parseCount(text);
    if (val === null) continue;
    counted.push({ href, text, val });
    if (counted.length === postsLimit) break;
  }

  // 2. Fallback : play_count du JSON GraphQL.
  if (sumOf(counted) === 0) {
    counted = (raw.playCounts || [])
      .filter(val => Number.isFinite(val) && val > 0)
      .slice(0, postsLimit)
      .map(val => ({ source: 'play_count', val }));
  }

  // 3. Fallback : recherche textuelle globale.
  if (sumOf(counted) === 0) {
    counted = parseAllViewsText(raw.bodyText)
      .slice(0, postsLimit)
      .map(val => ({ source: 'texte global', val }));
  }

  return { total: sumOf(counted), counted };
}

/**
 * Convertit le relevé brut de l'onglet Shorts YouTube en vues.
 * Appelée par instagram.js#buildViewsSummary.
 * @param {{items: Array<{href: string|null, text: string}>, spans: string[]}} raw
 * @returns {{total: number, counted: Array}}
 */
export function extractYouTubeViews(raw, postsLimit) {
  let counted = [];

  for (const { href, text } of raw.items || []) {
    const val = parseViewsText(text);
    if (val <= 0) continue;
    counted.push({ href, val });
    if (counted.length === postsLimit) break;
  }

  if (counted.length === 0) {
    for (const text of raw.spans || []) {
      const val = parseViewsText(text);
      if (val <= 0) continue;
      counted.push({ href: null, val });
      if (counted.length === postsLimit) break;
    }
  }

  return { total: sumOf(counted), counted };
}

function sumOf(counted) {
  return counted.reduce((sum, c) => sum + c.val, 0);
}
