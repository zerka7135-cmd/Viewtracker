// Export PDF côté client — mêmes données que csv.js, mise en page tabulaire
// simple (titre, date, tableau) plutôt qu'une reproduction visuelle du
// dashboard (graphiques compris) : jspdf-autotable suffit largement pour un
// export "classement à imprimer/partager", pas besoin de recréer les
// composants SVG des graphiques en PDF pour cet usage.
//
// Import dynamique : jsPDF embarque html2canvas + dompurify même si on ne
// s'en sert pas (juste du texte/tableau), ce qui alourdissait le bundle
// initial de ~200 Ko chargés sur CHAQUE visite du dashboard pour une
// fonctionnalité utilisée occasionnellement — chargé uniquement au premier
// clic sur "Exporter en PDF" à la place.

/**
 * @param {string} filename Sans extension.
 * @param {string} title Titre affiché en haut du document.
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 */
export async function downloadPdf(filename, title, headers, rows) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable')
  ]);

  const doc = new jsPDF({ orientation: 'landscape' });

  doc.setFontSize(16);
  doc.text(title, 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Exporté le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} — ViewTracker`, 14, 25);

  autoTable(doc, {
    startY: 32,
    head: [headers],
    body: rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '—' : String(cell)))),
    headStyles: { fillColor: [10, 132, 255] },
    styles: { fontSize: 9 },
    theme: 'striped'
  });

  doc.save(`${filename}.pdf`);
}
