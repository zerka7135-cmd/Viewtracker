// Export PDF côté client — seul format d'export du dashboard (le CSV a été
// retiré). Mise en page tabulaire (titre, résumé, tableau, pied de page)
// plutôt qu'une reproduction visuelle du dashboard (graphiques compris) :
// jspdf-autotable suffit largement pour un export "à imprimer/partager",
// pas besoin de recréer les composants SVG des graphiques en PDF.
//
// Import dynamique : jsPDF embarque html2canvas + dompurify même si on ne
// s'en sert pas (juste du texte/tableau), ce qui alourdissait le bundle
// initial de ~200 Ko chargés sur CHAQUE visite du dashboard pour une
// fonctionnalité utilisée occasionnellement — chargé uniquement au premier
// clic sur "Exporter en PDF" à la place (voir le loader jspdfCache
// ci-dessous, réutilisé si l'utilisateur exporte plusieurs fois de suite).

const ACCENT = [10, 132, 255]; // var(--accent), pas d'accès aux custom properties CSS ici

let jspdfCache = null;
/** Charge jsPDF/autoTable une seule fois par session (pas à chaque export). */
function loadJsPdf() {
  if (!jspdfCache) {
    jspdfCache = Promise.all([import('jspdf'), import('jspdf-autotable')]);
  }
  return jspdfCache;
}

/**
 * @param {string} filename Sans extension.
 * @param {string} title Titre affiché en haut du document.
 * @param {string} [subtitle] Sous-titre (ex. nom du compte, période).
 * @param {Array<[string, string]>} [summary] Paires libellé/valeur affichées en résumé au-dessus du tableau (ex. total cumulé, IG/TT/YT).
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 */
export async function downloadPdf(filename, title, subtitle, summary, headers, rows) {
  const [{ jsPDF }, { default: autoTable }] = await loadJsPdf();

  const doc = new jsPDF({ orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // En-tête : bandeau de couleur + titre/sous-titre en blanc, identité
  // visuelle cohérente avec le reste du dashboard plutôt qu'une page blanche
  // avec juste du texte noir.
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, pageWidth, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text(title, 14, 15);
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(subtitle, 14, 21);
  }

  let cursorY = 34;

  // Résumé (KPI clés) en cartouches avant le tableau détaillé — donne le
  // total d'un coup d'œil sans avoir à parcourir toutes les lignes.
  if (summary && summary.length > 0) {
    const cardWidth = (pageWidth - 28 - (summary.length - 1) * 6) / summary.length;
    summary.forEach(([label, value], i) => {
      const x = 14 + i * (cardWidth + 6);
      doc.setDrawColor(230);
      doc.setFillColor(247, 247, 249);
      doc.roundedRect(x, cursorY, cardWidth, 20, 2, 2, 'FD');
      doc.setTextColor(120);
      doc.setFontSize(8.5);
      doc.text(label, x + 5, cursorY + 8);
      doc.setTextColor(30);
      doc.setFontSize(13);
      doc.setFont(undefined, 'bold');
      doc.text(String(value), x + 5, cursorY + 16);
      doc.setFont(undefined, 'normal');
    });
    cursorY += 28;
  }

  autoTable(doc, {
    startY: cursorY,
    head: [headers],
    body: rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '—' : String(cell)))),
    headStyles: { fillColor: ACCENT },
    styles: { fontSize: 9 },
    theme: 'striped',
    // Pied de page (numéro de page + date/marque) sur chaque page, y
    // compris celles ajoutées automatiquement si le tableau déborde.
    didDrawPage: () => {
      const pageCount = doc.internal.getNumberOfPages();
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `ViewTracker — exporté le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        14,
        pageHeight - 8
      );
      doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber} / ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
    }
  });

  doc.save(`${filename}.pdf`);
}
