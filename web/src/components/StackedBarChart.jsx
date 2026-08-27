import { useState } from 'react';
import { fmt, fmtShort, fmtDate } from '../format.js';

const SEGMENT_GAP = 2; // px — surface gap entre segments empilés
const BAR_RADIUS = 4; // px — arrondi uniquement à l'extrémité loin de la ligne de base (haut de la pile)
const BAR_MAX_WIDTH = 24; // px — un bar ne remplit jamais tout son créneau, l'air fait partie du dessin

/** Pas "rond" (1/2/5 × 10^n) pour des graduations lisibles, façon d3 "nice ticks". */
function niceStep(roughStep) {
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

/** 4 graduations rondes de 0 à >= max (ex. max=8700 -> [0, 2000, 4000, 6000, 8000]). */
function niceTicks(max, targetCount = 4) {
  if (max <= 0) return [0];
  const step = niceStep(max / targetCount);
  const ticks = [];
  for (let v = 0; v <= max + step; v += step) ticks.push(v);
  return ticks;
}

/**
 * Barres empilées par jour (IG/TT/YT), avec graduations Y, dates sous
 * l'axe et tooltip au survol (détail par plateforme) — remplace l'ancien
 * rendu en divs sans repère de valeur ni interaction. Même langage visuel
 * que AreaChart.jsx (carte flottante, mêmes tokens de couleur).
 * @param {Array<{date: string, ig: number, tt: number, yt: number, total: number}>} data
 * @param {Record<'ig'|'tt'|'yt', string>} colors
 */
export default function StackedBarChart({ data, colors, height = 160 }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const rawMax = Math.max(...data.map((d) => d.total), 1);
  const ticks = niceTicks(rawMax).reverse(); // du plus grand (haut) au plus petit (bas, 0)
  const axisMax = ticks[0];

  // Un label sur 2/3/4 selon la place dispo, pour ne jamais faire chevaucher
  // le texte — jusqu'à ~10 barres, chaque date tient toute seule.
  const labelStride = data.length <= 10 ? 1 : data.length <= 20 ? 2 : Math.ceil(data.length / 10);

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const hoveredPct = hoverIndex !== null ? ((hoverIndex + 0.5) / data.length) * 100 : 0;

  if (data.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', height }}>Pas encore de données.</div>;
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex' }}>
        {/* Axe Y : graduations rondes, gris en retrait (recessive) — la
            donnée reste la seule chose "forte" du graphique. */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height, width: 32, flexShrink: 0 }}>
          {ticks.map((t) => (
            <div key={t} className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1, textAlign: 'right', paddingRight: 8, transform: 'translateY(-4px)' }}>
              {fmtShort(t)}
            </div>
          ))}
        </div>

        <div style={{ position: 'relative', flex: 1, height }}>
          {/* Gridlines en trait fin, un cran hors de la surface — jamais en
              pointillés, jamais assez sombres pour concurrencer les barres. */}
          {ticks.map((t) => (
            <div
              key={t}
              style={{
                position: 'absolute', left: 0, right: 0,
                top: `${(1 - t / axisMax) * 100}%`,
                borderTop: '1px solid var(--border)',
                pointerEvents: 'none'
              }}
            />
          ))}

          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 6, height: '100%' }}>
            {data.map((d, i) => {
              const segments = [
                { key: 'yt', value: d.yt }, // colonne bas -> haut : yt, tt, ig (ordre catégoriel fixe)
                { key: 'tt', value: d.tt },
                { key: 'ig', value: d.ig }
              ].filter((s) => s.value > 0);

              return (
                <div
                  key={d.date}
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
                  style={{ flex: 1, height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', cursor: 'pointer' }}
                >
                  <div
                    style={{
                      width: '100%',
                      maxWidth: BAR_MAX_WIDTH,
                      height: `${(d.total / axisMax) * 100}%`,
                      minHeight: d.total > 0 ? 3 : 0,
                      display: 'flex',
                      flexDirection: 'column-reverse',
                      gap: SEGMENT_GAP,
                      outline: hoverIndex === i ? '1px solid var(--border-strong)' : 'none',
                      outlineOffset: 2,
                      borderRadius: 2
                    }}
                  >
                    {segments.map((s, si) => (
                      <div
                        key={s.key}
                        style={{
                          height: `${(s.value / d.total) * 100}%`,
                          background: colors[s.key],
                          opacity: hoverIndex === null || hoverIndex === i ? 1 : 0.35,
                          // Seule l'extrémité la plus loin de la ligne de base
                          // (le sommet du dernier segment empilé) est arrondie.
                          borderRadius: si === segments.length - 1 ? `${BAR_RADIUS}px ${BAR_RADIUS}px 0 0` : 0,
                          transition: 'opacity 0.12s'
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 6, marginLeft: 32 }}>
        {data.map((d, i) => (
          <div
            key={d.date}
            style={{
              flex: 1, textAlign: 'center', fontSize: 10, color: 'var(--text-faint)',
              visibility: i % labelStride === 0 ? 'visible' : 'hidden'
            }}
          >
            {fmtDate(d.date)}
          </div>
        ))}
      </div>

      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: `calc(32px + ${hoveredPct}% * (100% - 32px) / 100%)`,
            top: 0,
            transform: `translate(${hoveredPct < 15 ? '-4%' : hoveredPct > 85 ? '-96%' : '-50%'}, calc(-100% - 8px))`,
            background: 'var(--card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 11.5,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
            zIndex: 5
          }}
        >
          <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}>{fmtDate(hovered.date)}</div>
          {[['ig', 'Instagram'], ['tt', 'TikTok'], ['yt', 'YouTube']].map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-faint)' }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: colors[key] }} />
                {label}
              </span>
              <span className="mono" style={{ fontWeight: 600, marginLeft: 10 }}>{fmt(hovered[key])}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-faint)' }}>Total</span>
            <span className="mono" style={{ fontWeight: 700, marginLeft: 10 }}>{fmt(hovered.total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
