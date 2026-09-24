import { useEffect, useState } from 'react';
import { fmt, fmtShort } from '../format.js';
import { getDaily } from '../api.js';
import { usePeriod } from '../usePeriod.js';
import PeriodSelector from './PeriodSelector.jsx';
import Bone from './Bone.jsx';

// « Jour par jour » (admin et manager) : clics totaux par jour en barres, puis
// un tableau de chaleur clipper × jour dont l'intensité suit le nombre de
// clics. Fenêtres fixes (1, 7, 14, 30 jours), pas de « Tout » ni de dates libres.
const OPTIONS = ['today', '7', '14', '30'];

export default function DailyView({ onOpenClipper, onToast }) {
  const period = usePeriod('14');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getDaily(period.range)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) onToast(`Erreur : ${err.message}`); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.range.from, period.range.to]);

  const days = data?.days ?? [];
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? [];
  const peak = Math.max(1, ...rows.flatMap((r) => r.values));
  const dayPeak = Math.max(1, ...totals);
  const grandTotal = totals.reduce((s, v) => s + v, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PeriodSelector period={period} options={OPTIONS} custom={false} />

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>Clics totaux par jour</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 128 }} role="img" aria-label="Clics totaux par jour">
          {totals.map((v, i) => (
            <div key={days[i]} title={`${days[i]} : ${fmt(v)} clics`} style={{ flex: 1, minWidth: 2, height: `${Math.max(2, (v / dayPeak) * 100)}%`, background: 'var(--accent)', borderRadius: '3px 3px 0 0', opacity: v ? 1 : 0.25 }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
          <span>{days[0]?.slice(5)}</span><span>{days[days.length - 1]?.slice(5)}</span>
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ position: 'sticky', left: 0, background: 'var(--card)', padding: 12, textAlign: 'left' }}>Clipper</th>
              {days.map((d) => <th key={d} className="mono" style={{ padding: 8, textAlign: 'right', fontWeight: 400 }}>{d.slice(8)}/{d.slice(5, 7)}</th>)}
              <th style={{ padding: 12, textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} style={{ borderBottom: '1px solid var(--table-row-border)' }}>
                <td style={{ position: 'sticky', left: 0, background: 'var(--card)', padding: 12, fontWeight: 600 }}>
                  <button type="button" className="btn-link" style={{ padding: 0, color: 'inherit', fontWeight: 600 }} onClick={() => onOpenClipper(r.name)}>{r.name}</button>
                </td>
                {r.values.map((v, i) => (
                  <td key={days[i]} className="mono" style={{ padding: 8, textAlign: 'right', background: v ? `color-mix(in oklab, var(--accent) ${Math.round(8 + (v / peak) * 55)}%, transparent)` : undefined }}>
                    {v ? fmtShort(v) : <span style={{ opacity: 0.35 }}>·</span>}
                  </td>
                ))}
                <td className="mono" style={{ padding: 12, textAlign: 'right', fontWeight: 700 }}>{fmt(r.total)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border-strong)', fontWeight: 700 }}>
              <td style={{ position: 'sticky', left: 0, background: 'var(--card)', padding: 12 }}>Total</td>
              {totals.map((v, i) => <td key={days[i]} className="mono" style={{ padding: 8, textAlign: 'right' }}>{fmtShort(v)}</td>)}
              <td className="mono" style={{ padding: 12, textAlign: 'right', color: 'var(--accent)' }}>{fmt(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
        {!data && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => <Bone key={i} h={16} />)}
          </div>
        )}
      </div>
    </div>
  );
}
