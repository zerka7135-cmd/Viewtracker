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
 * "2026-08-09" → "9 août" — utilisé dans le tooltip des graphiques, voir
 * AreaChart.jsx/MultiLineChart.jsx. Chaque entrée de l'historique est une
 * collecte quotidienne (voir history.js) : pas de granularité horaire à
 * gérer ici (l'ancien filtre "24h" fabriquait des points horaires factices,
 * retiré — voir dashboardData.js).
 */
export function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
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

/**
 * ISO timestamp → "il y a 2h (14h32)" — même repère relatif que
 * fmtRelativeTime, avec l'heure exacte entre parenthèses juste à côté
 * (voir ScanStatusIndicator.jsx). "à l'instant" n'a pas besoin de cette
 * précision en plus, l'heure serait redondante avec l'instant présent.
 */
export function fmtRelativeTimeWithClock(isoString) {
  const relative = fmtRelativeTime(isoString);
  if (!relative || relative === "à l'instant") return relative;
  const clock = new Date(isoString).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${relative} (${clock})`;
}

/**
 * Montant en euros : sans décimales dès 1 000 € ("1 385 €"), avec deux
 * dessous ("0,50 €") — même règle que l'app de référence.
 */
export function eur(n) {
  const digits = Math.abs(n) >= 1000 ? 0 : 2;
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Pourcentage à une décimale ("5,5 %"), « — » quand il n'y a rien à diviser. */
export function pct(n) {
  return n === null || n === undefined ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

export function roasLabel(n) {
  return n === null || n === undefined ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}
