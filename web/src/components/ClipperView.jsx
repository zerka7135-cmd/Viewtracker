import { useEffect, useState } from 'react';
import { fmt, fmtShort, eur, pct } from '../format.js';
import { getClipperDetail } from '../api.js';
import { usePeriod } from '../usePeriod.js';
import PeriodSelector from './PeriodSelector.jsx';
import AreaChart from './AreaChart.jsx';

// Page d'un clipper — c'est le Dashboard d'un profil clipper (son propre
// compte), et le détail qu'ouvrent l'admin et le manager depuis « Tous les
// clippers » : chiffres clés, courbe des clics par jour (avec les gains du
// jour au survol) et détail par lien. Le serveur ne renvoie à un clipper que
// son propre compte (voir /api/clipper dans src/server.js).

function Kpi({ label, value, accent }) {
  return (
    <div className="card kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: 20, color: accent ? 'var(--accent)' : undefined }}>{value}</div>
    </div>
  );
}

export default function ClipperView({ account, onBack, onToast }) {
  const period = usePeriod('7');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (period.invalid) return undefined;
    let cancelled = false;
    setLoading(true);
    getClipperDetail(period.range, account)
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch((err) => { if (!cancelled) onToast(`Erreur : ${err.message}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // onToast change à chaque rendu du parent : le suivre relancerait la requête en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.range.from, period.range.to, period.invalid, account]);

  if (!detail && !loading) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        {account ? 'Compte introuvable.' : 'Ton profil n’est pas encore relié à un compte suivi. Contacte ton admin.'}
      </div>
    );
  }

  const k = detail?.kpis;
  const chart = detail?.series.map((p) => ({ date: p.date, value: p.clicks, gains: p.gains })) ?? [];
  const links = detail?.links ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, opacity: loading && detail ? 0.6 : 1, transition: 'opacity 0.15s' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        {onBack ? <button type="button" className="btn btn-ghost" onClick={onBack} style={{ borderRadius: 980 }}>← Tous les clippers</button> : <span />}
        <PeriodSelector period={period} />
      </div>

      <div className="kpi-grid kpi-grid-auto">
        <Kpi label="Vues" value={k ? (k.views === null ? '—' : fmt(k.views)) : '—'} />
        <Kpi label="Clics" value={k ? fmt(k.clicks) : '—'} />
        <Kpi label="Forms remplis" value={k ? fmt(k.forms) : '—'} />
        <Kpi label="Taux d’opt-in" value={k ? pct(k.optInRate) : '—'} />
        <Kpi label="€ / trafic" value={k ? eur(k.eurPerTraffic) : '—'} />
        <Kpi label="Gains" value={k ? eur(k.gains) : '—'} accent />
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Clics par jour</div>
        {chart.length > 1 ? (
          <AreaChart data={chart} color="var(--accent)" height={220} fluid unit="clics" renderExtra={(p) => eur(p.gains)} />
        ) : (
          <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            {chart.length === 1 ? `${fmt(chart[0].value)} clic${chart[0].value > 1 ? 's' : ''} sur cette journée` : 'Pas encore de données.'}
          </div>
        )}
        {detail && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            Tarif : {eur(detail.ratePerClick * 1000)} pour 1 000 clics
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 12px' }}>Détail par lien</div>
        <div className="card">
          {links.length ? links.map((l) => (
            <div key={l.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '14px 18px', fontSize: 13, borderBottom: '1px solid var(--table-row-border)' }}>
              <span style={{ fontWeight: 600, minWidth: 0 }} className="ellipsis">{l.name}</span>
              <span className="mono" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {fmt(l.clicks)} clics · <span style={{ color: 'var(--accent)' }}>{eur(l.gains)}</span>
              </span>
            </div>
          )) : (
            <div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>Aucune donnée par lien sur cette période.</div>
          )}
        </div>
      </div>
    </div>
  );
}
