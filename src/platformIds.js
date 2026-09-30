// Décodage de la date de publication depuis l'identifiant d'une vidéo
// TikTok ou Instagram (aucune requête, aucun accès réseau) — module partagé
// entre supabaseViews.js et publicationsLog.js pour éviter un import
// circulaire (accountsStore.js -> publicationsLog.js -> supabaseViews.js ->
// accountsStore.js).

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Date de publication (ms) lue dans l'identifiant (TikTok, Instagram) ; YouTube : null. */
export function publishedMs(platform, id) {
  try {
    if (platform === 'tt') return Number(BigInt(id) >> 32n) * 1000;
    if (platform === 'ig') {
      let n = 0n;
      for (const c of String(id).slice(0, 11)) {
        const v = B64.indexOf(c);
        if (v < 0) return null;
        n = n * 64n + BigInt(v);
      }
      return Number(n >> 23n) + 1314220021721;
    }
  } catch {
    // identifiant inattendu : date inconnue
  }
  return null;
}

/** Jour de publication (YYYY-MM-DD, UTC) ; null si inconnu. */
export function publishedDay(platform, id) {
  const ms = publishedMs(platform, id);
  return ms ? new Date(ms).toISOString().slice(0, 10) : null;
}
