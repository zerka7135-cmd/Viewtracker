// Export CSV côté client — pas de route serveur dédiée, les données sont
// déjà chargées dans le navigateur (voir DashboardView.jsx/AccountDrawer.jsx),
// donc aucun aller-retour réseau supplémentaire n'est nécessaire.

/** Échappe une valeur pour une cellule CSV (RFC 4180) : guillemets doublés,
 * entourée de guillemets si elle contient une virgule/un guillemet/un saut
 * de ligne. */
function escapeCsvCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * @param {string} filename Sans extension, ajoutée automatiquement.
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 */
export function downloadCsv(filename, headers, rows) {
  // ﻿ (BOM UTF-8) en tête : sans lui, Excel (Windows en particulier)
  // interprète les accents comme du Latin-1 et affiche "Ã©" à la place de
  // "é" — un problème classique d'export CSV en français.
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(','));
  const csv = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
