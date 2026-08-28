import { useState } from 'react';
import { fmt, fmtDate } from '../format.js';

const DEFAULT_SERIES = [['ig', 'Instagram'], ['tt', 'TikTok'], ['yt', 'YouTube']];

/**
 * Une ligne par série, un seul axe partagé (jamais un axe par série — voir
 * dataviz skill, "one axis") puisqu'elles partagent la même unité (des
 * vues). Même langage visuel que AreaChart.jsx (tiroir de détail d'un
 * compte) : pas d'axe/gridlines visibles, juste les lignes et un tooltip
 * flottant au survol regroupant toutes les séries.
 *
 * Générique : `series` par défaut = les 3 plateformes (usage historique,
 * voir DashboardView.jsx), mais accepte n'importe quelle liste de
 * [clé, libellé] — réutilisé pour comparer des comptes entre eux plutôt
 * que des plateformes (voir AccountComparisonModal.jsx), pas de deuxième
 * composant à dupliquer/maintenir pour un besoin identique (une ligne par
 * catégorie, même échelle).
 * @param {Array<{date: string, [key: string]: number}>} data
 * @param {Record<string, string>} colors
 * @param {Array<[string, string]>} [series]
 */
export default function MultiLineChart({ data, colors, series = DEFAULT_SERIES, width = 560, height = 150 }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const SERIES = series;

  if (data.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', height }}>Pas encore de données.</div>;
  }

  const max = Math.max(...data.flatMap((d) => SERIES.map(([key]) => d[key])), 1);

  const xAt = (i) => (data.length > 1 ? (i / (data.length - 1)) * width : width / 2);
  const yAt = (value) => height - (value / max) * (height - 10);

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    let closest = 0;
    let closestDist = Infinity;
    data.forEach((_, i) => {
      const dist = Math.abs(xAt(i) - relX);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    });
    setHoverIndex(closest);
  };

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const hoveredX = hoverIndex !== null ? xAt(hoverIndex) : 0;
  const hoveredPct = (hoveredX / width) * 100;

  // Fingerprint du jeu de données affiché (période/plateforme) : sert de
  // `key` React pour remonter les lignes et rejouer leur animation de
  // tracé quand l'utilisateur change de filtre, pas seulement au tout
  // premier rendu.
  const datasetKey = `${data.length}-${data[0]?.date || ''}-${data[data.length - 1]?.date || ''}`;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block', overflow: 'visible', cursor: data.length > 1 ? 'crosshair' : 'default' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {hovered && (
          <line x1={hoveredX} y1="0" x2={hoveredX} y2={height} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3,3" opacity="0.4" vectorEffect="non-scaling-stroke" />
        )}
        {/* Révélation au tracé via clip-path plutôt que stroke-dasharray/
            pathLength : ce dernier casse (ligne bloquée à mi-parcours) une
            fois combiné à preserveAspectRatio="none" (étirement non
            uniforme) — un clip-path en pourcentage n'a pas ce problème,
            indépendant de l'échelle. Remonté (key=datasetKey) pour rejouer
            l'animation à chaque changement de filtre/période. */}
        <g key={datasetKey} className="chart-reveal">
          {SERIES.map(([key]) => (
            <polyline
              key={key}
              points={data.map((d, i2) => `${xAt(i2)},${yAt(d[key])}`).join(' ')}
              fill="none"
              stroke={colors[key]}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {SERIES.map(([key]) => (
            <circle
              key={`${key}-dot`}
              cx={xAt(data.length - 1)} cy={yAt(data[data.length - 1][key])} r="4"
              fill={colors[key]} stroke="var(--card)" strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        {hovered && SERIES.map(([key]) => (
          <circle key={key} cx={hoveredX} cy={yAt(hovered[key])} r="4" fill={colors[key]} stroke="var(--card)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: `${hoveredPct}%`,
            top: 0,
            transform: `translate(${hoveredPct < 15 ? '-4%' : hoveredPct > 85 ? '-96%' : '-50%'}, calc(-100% - 8px))`,
            background: 'var(--card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 11.5,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
            zIndex: 5
          }}
        >
          <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 2 }}>{fmtDate(hovered.date)}</div>
          {SERIES.map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-faint)' }}>
                <span style={{ display: 'inline-block', width: 10, height: 2, background: colors[key], borderRadius: 1 }} />
                {label}
              </span>
              <span className="mono" style={{ fontWeight: 700, marginLeft: 10 }}>{fmt(hovered[key])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
