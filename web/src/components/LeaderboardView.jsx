import { useEffect, useState } from 'react';
import { fmt, eur } from '../format.js';
import { getLeaderboard } from '../api.js';
import { usePeriod } from '../usePeriod.js';
import PeriodSelector from './PeriodSelector.jsx';

// Classement aux clics, ouvert aux trois profils : podium des trois premiers,
// puis la liste avec une barre relative au premier. Un clipper voit « Ta
// position » et l'écart avec celui qui le précède ; les gains de chacun ne
// sont affichés (et même envoyés par le serveur) que pour l'admin.
const PODIUM_HEIGHTS = [176, 128, 96]; // 1er, 2e, 3e

export default function LeaderboardView({ role, account, onToast }) {
  const period = usePeriod('7');
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (period.invalid) return undefined;
    let cancelled = false;
    getLeaderboard(period.range)
      .then((data) => { if (!cancelled) setRows(data.rows); })
      .catch((err) => { if (!cancelled) onToast(`Erreur : ${err.message}`); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.range.from, period.range.to, period.invalid]);

  const list = rows ?? [];
  const myIndex = account ? list.findIndex((r) => r.name === account) : -1;
  const podium = list.slice(0, 3);
  const top = list[0]?.clicks || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PeriodSelector period={period} />

      {myIndex >= 0 && (
        <div className="card" style={{ padding: 20, borderColor: 'color-mix(in oklab, var(--accent) 50%, transparent)' }}>
          <div className="kpi-label">Ta position</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 16px', marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 34, fontWeight: 700, color: 'var(--accent)' }}>#{myIndex + 1}</span>
            <span className="mono">{fmt(list[myIndex].clicks)} clics</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {myIndex === 0
                ? 'Tu es en tête 🔥'
                : `${fmt(list[myIndex - 1].clicks - list[myIndex].clicks + 1)} clics pour dépasser ${list[myIndex - 1].name}`}
            </span>
          </div>
        </div>
      )}

      {podium.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, alignItems: 'end' }}>
          {[1, 0, 2].map((rank) => {
            const p = podium[rank];
            if (!p) return <div key={rank} />;
            const mine = p.name === account;
            return (
              <div key={p.name} style={{ textAlign: 'center' }}>
                <div className="ellipsis" style={{ fontWeight: 700, color: mine ? 'var(--accent)' : undefined }}>{p.name}</div>
                <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{fmt(p.clicks)} clics</div>
                <div
                  style={{
                    height: PODIUM_HEIGHTS[rank], display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 12,
                    borderRadius: '12px 12px 0 0', border: '1px solid var(--border)', borderBottom: 0,
                    background: rank === 0 ? 'var(--accent)' : 'var(--card)', color: rank === 0 ? 'var(--on-accent)' : 'var(--text)'
                  }}
                >
                  <span className="mono" style={{ fontSize: 30, fontWeight: 800 }}>{rank + 1}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        {list.slice(3).map((r, i) => {
          const mine = r.name === account;
          return (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', fontSize: 13, borderBottom: '1px solid var(--table-row-border)', background: mine ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : undefined }}>
              <span className="mono" style={{ width: 32, color: 'var(--text-muted)' }}>#{i + 4}</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: mine ? 'var(--accent)' : undefined }} className="ellipsis">{r.name}{mine && ' (toi)'}</span>
              <div className="table-cell-hide-mobile" style={{ width: 160, height: 6, borderRadius: 3, background: 'var(--card-hover)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${top ? (r.clicks / top) * 100 : 0}%`, background: 'var(--accent)' }} />
              </div>
              <span className="mono" style={{ width: 90, textAlign: 'right' }}>{fmt(r.clicks)}</span>
              {role === 'admin' && r.earnings !== undefined && <span className="mono" style={{ width: 100, textAlign: 'right', color: 'var(--accent)' }}>{eur(r.earnings)}</span>}
            </div>
          );
        })}
        {rows && list.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Aucun clic sur cette période.</div>}
        {!rows && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</div>}
      </div>
    </div>
  );
}
