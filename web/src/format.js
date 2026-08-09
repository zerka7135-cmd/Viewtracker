// Mêmes règles de formatage que la maquette d'origine (ViewTracker Dashboard.dc.html).

export function fmt(n) {
  return Math.round(n).toLocaleString('fr-FR');
}

export function fmtShort(n) {
  n = Math.round(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 < 50_000 ? 0 : 1).replace('.0', '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 < 50 ? 0 : 1).replace('.0', '') + 'K';
  return String(n);
}

export function platformLabel(value) {
  return value === null || value === undefined ? '—' : fmtShort(value);
}

/**
 * "2026-08-09" → "9 août", ou "2026-08-09T14:00" → "14h00" (filtre 24h,
 * voir getHistorySeriesHourly côté serveur) — utilisé dans le tooltip des
 * graphiques, voir AreaChart.jsx.
 */
export function fmtDate(dateStr) {
  if (!dateStr) return '';
  const isHourly = dateStr.includes('T');
  const d = new Date(isHourly ? dateStr : `${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return isHourly
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/**
 * ISO timestamp → "à l'instant" / "il y a 12 min" / "il y a 3h" / "hier" /
 * "il y a 5 jours" — sert de repère de fraîcheur des données sur le
 * dashboard (voir DashboardView.jsx), important depuis que le scan
 * manuel a été retiré : sans ça, rien n'indique à l'utilisateur si les
 * chiffres affichés datent d'il y a 5 minutes ou de 3 jours.
 */
export function fmtRelativeTime(isoString) {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));

  if (diffSec < 60) return "à l'instant";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH}h`;
  const diffDays = Math.round(diffH / 24);
  if (diffDays === 1) return 'hier';
  return `il y a ${diffDays} jours`;
}
