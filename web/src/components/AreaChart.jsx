import { useEffect, useRef, useState } from 'react';
import { fmt, fmtDate } from '../format.js';

// Graphe SVG à aire pleine + ligne, même principe que la maquette
// d'origine, avec un tooltip au survol (date + valeur exacte) — sans ça,
// impossible de lire une valeur précise sur la courbe, ce qui nuit à la
// confiance dans un outil dont la valeur repose sur des chiffres.
//
// `data` : [{date, value}] — préféré à un simple tableau de valeurs pour
// pouvoir afficher la date dans le tooltip. `values` (ancien prop, juste
// des nombres) reste accepté pour compatibilité : dans ce cas le tooltip
// n'affiche que la valeur, sans date.
export default function AreaChart({ data, values, color, width: fixedWidth = 560, height = 150, unit = 'vues', renderExtra = null, fluid = false }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  // `fluid` : le graphique prend la largeur réelle de son conteneur (au lieu
  // d'un repère fixe de 560 px qui, dans une carte large, n'en occupe que la
  // moitié) et se redessine quand cette largeur change.
  const wrapRef = useRef(null);
  const [measured, setMeasured] = useState(0);
  useEffect(() => {
    if (!fluid || !wrapRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setMeasured(Math.round(entry.contentRect.width)));
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [fluid]);
  const width = fluid && measured > 0 ? measured : fixedWidth;

  const points = data || (values || []).map((value) => ({ date: null, value }));
  const safe = points.length > 1 ? points : [{ date: null, value: 0 }, { date: null, value: 0 }];
  const nums = safe.map((p) => p.value ?? 0);
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const range = Math.max(max - min, 1);

  const dots = safe.map((p, i) => ({
    x: (i / (safe.length - 1)) * width,
    y: height - (((p.value ?? 0) - min) / range) * (height - 10),
    date: p.date,
    value: p.value ?? 0,
    raw: p
  }));
  const line = dots.map((d) => `${d.x},${d.y}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    let closest = 0;
    let closestDist = Infinity;
    dots.forEach((d, i) => {
      const dist = Math.abs(d.x - relX);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    });
    setHoverIndex(closest);
  };

  const hovered = hoverIndex !== null ? dots[hoverIndex] : null;
  const hoveredPct = hovered ? (hovered.x / width) * 100 : 0;

  // Fingerprint du jeu de données affiché : sert de `key` React pour
  // remonter la ligne et rejouer son animation de tracé à chaque
  // changement de filtre/période, pas seulement au tout premier rendu.
  const datasetKey = `${safe.length}-${safe[0]?.date || ''}-${safe[safe.length - 1]?.date || ''}`;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height, display: 'block', overflow: 'visible', cursor: dots.length > 1 ? 'crosshair' : 'default' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <g key={datasetKey} className="chart-reveal">
          <polygon points={area} fill={color} opacity="0.1" />
          <polyline points={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {hovered && (
          <>
            <line x1={hovered.x} y1="0" x2={hovered.x} y2={height} stroke={color} strokeWidth="1" strokeDasharray="3,3" opacity="0.4" />
            <circle cx={hovered.x} cy={hovered.y} r="4" fill={color} stroke="var(--card)" strokeWidth="2" />
          </>
        )}
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
          {hovered.date && <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{fmtDate(hovered.date)}</div>}
          <div className="mono" style={{ fontWeight: 700 }}>{fmt(hovered.value)} {unit}</div>
          {renderExtra && <div className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>{renderExtra(hovered.raw)}</div>}
        </div>
      )}
    </div>
  );
}
