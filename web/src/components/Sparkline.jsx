// Petite courbe SVG (34x24), même logique que la maquette d'origine : les
// valeurs sont normalisées sur la hauteur disponible, sans axe ni légende.
export default function Sparkline({ values, color }) {
  const safe = values && values.length > 1 ? values : [0, 0];
  const points = safe.map((v, i, arr) => {
    const max = Math.max(...arr, 1);
    const x = (i / (arr.length - 1)) * 34;
    const y = 24 - (v / max) * 22;
    return `${x},${y}`;
  }).join(' ');

  // Fingerprint des valeurs affichées : sert de `key` React pour remonter
  // la ligne et rejouer son animation de tracé quand les données changent
  // (nouvelle collecte), pas seulement au tout premier rendu.
  const dataKey = safe.join(',');

  return (
    <svg viewBox="0 0 34 24" style={{ width: 34, height: 24, flexShrink: 0 }}>
      <polyline key={dataKey} className="chart-reveal" points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
