import { useEffect, useState } from 'react';
import { fmt, fmtShort, platformLabel } from '../format.js';
import { getHistory } from '../api.js';
import { useAccountFilters } from '../useAccountFilters.js';
import Sparkline from './Sparkline.jsx';
import AreaChart from './AreaChart.jsx';
import StackedBarChart from './StackedBarChart.jsx';
import { IconSearch } from './icons.jsx';

const PLATFORM_COLOR = { ig: '#e0409e', tt: '#1a93c0', yt: '#ff453a' };
const PLATFORM_NAME = { ig: 'Instagram', tt: 'TikTok', yt: 'YouTube' };
// `hours` (24h) vs `days` — deux granularités différentes côté serveur
// (voir getHistorySeriesHourly), la collecte horaire n'a de sens que sur
// les dernières 24h.
const CHART_RANGES = [
  { key: '24h', label: '24h', hours: 24 },
  { key: '7', label: '7j', days: 7 },
  { key: '14', label: '14j', days: 14 },
  { key: '30', label: '30j', days: 30 }
];

/** "24 dernières heures" / "14 derniers jours" — pour les titres de graphique. */
function rangeLongLabel(range) {
  return range.hours ? '24 dernières heures' : `${range.days} derniers jours`;
}
/** "24h" / "14 jours" — pour le texte de tendance ("▲ 12% sur ..."). */
function rangeShortLabel(range) {
  return range.hours ? '24h' : `${range.days} jours`;
}

// Version sans mode Clics (voir backup/dashboard-rewrite-27-08 pour la
// version complète avec suivi de lien en bio) — juste les vues pour
// l'instant.
export default function DashboardView({ kpis, accounts, onOpenDrawer }) {
  const [chartRange, setChartRange] = useState(CHART_RANGES[2]); // 14j par défaut
  const [platformSeries, setPlatformSeries] = useState({ ig: [], tt: [], yt: [] });
  const f = useAccountFilters(accounts);

  // Une seule requête (les 3 séries par plateforme) alimente le graphique
  // fusionné ci-dessous : en filtre "Plateforme : toutes", les barres
  // empilées montrent à la fois la tendance (hauteur totale) et la
  // répartition (couleurs) ; en filtrant une plateforme précise, seule sa
  // courbe est affichée. Un seul chargement réseau plutôt que 2 endpoints
  // séparés pour la tendance et la répartition.
  useEffect(() => {
    let cancelled = false;
    Promise.all([getHistory(chartRange, 'ig'), getHistory(chartRange, 'tt'), getHistory(chartRange, 'yt')]).then(([ig, tt, yt]) => {
      if (!cancelled) setPlatformSeries({ ig: ig.series, tt: tt.series, yt: yt.series });
    }).catch(() => { if (!cancelled) setPlatformSeries({ ig: [], tt: [], yt: [] }); });
    return () => { cancelled = true; };
  }, [chartRange]);

  const combinedChart = platformSeries.ig.map((entry, i) => {
    const ig = entry.value;
    const tt = platformSeries.tt[i]?.value ?? 0;
    const yt = platformSeries.yt[i]?.value ?? 0;
    return { date: entry.date, ig, tt, yt, total: ig + tt + yt };
  });

  const chartData = combinedChart.map((d) => ({ date: d.date, value: f.platform === 'all' ? d.total : d[f.platform] }));
  const trendPct = chartData.length >= 2 && chartData[0].value > 0
    ? ((chartData[chartData.length - 1].value - chartData[0].value) / chartData[0].value) * 100
    : 0;

  const warningsCount = kpis.warningsCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="kpi-grid">
        <div className="card kpi-card">
          <div className="kpi-label">Vues totales (all-time)</div>
          <div className="kpi-value">{fmt(kpis.totalAllTime)}</div>
          <div className="kpi-sub">sur {kpis.accountsCount} comptes suivis</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-label">Vues gagnées (24h)</div>
          <div className="kpi-value">{fmt(kpis.totalGrowth24h)}</div>
          <div className="kpi-sub" style={{ color: 'var(--green)' }}>depuis la dernière collecte</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-label">Comptes suivis</div>
          <div className="kpi-value">{kpis.accountsCount}</div>
          <div className="kpi-sub" style={{ color: warningsCount ? 'var(--orange)' : 'var(--text-muted)' }}>
            {warningsCount ? `${warningsCount} en attente de configuration` : 'tous configurés'}
          </div>
        </div>
      </div>

      <div className="content-grid">
        <div className="stack">
          <div className="card" style={{ padding: '20px 22px' }}>
            <div className="card-header">
              <div>
                <div className="card-title">
                  Vues {f.platform === 'all' ? 'totales' : PLATFORM_NAME[f.platform]} — {rangeLongLabel(chartRange)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {f.platform === 'all' ? 'Tendance et répartition par plateforme' : `Isolé sur ${PLATFORM_NAME[f.platform]} — change le filtre « Plateforme » ci-dessous pour comparer`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: trendPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {trendPct >= 0 ? '▲' : '▼'} {Math.abs(trendPct).toFixed(1)}% sur {rangeShortLabel(chartRange)}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {CHART_RANGES.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      className="btn"
                      onClick={() => setChartRange(r)}
                      style={{
                        padding: '5px 10px', borderRadius: 980, fontSize: 11, fontWeight: 600,
                        border: `1px solid ${r.key === chartRange.key ? 'var(--accent)' : 'var(--border-strong)'}`,
                        background: r.key === chartRange.key ? 'var(--accent)' : 'transparent',
                        color: r.key === chartRange.key ? '#fff' : 'var(--text-faint)'
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {f.platform === 'all' ? (
              <>
                <StackedBarChart data={combinedChart} colors={PLATFORM_COLOR} />
                <div style={{ display: 'flex', gap: 18, marginTop: 14, fontSize: 11.5, color: 'var(--text-faint)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: PLATFORM_COLOR.ig }} />Instagram</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: PLATFORM_COLOR.tt }} />TikTok</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: PLATFORM_COLOR.yt }} />YouTube</div>
                </div>
              </>
            ) : (
              <AreaChart data={chartData} color={PLATFORM_COLOR[f.platform]} />
            )}
          </div>

          <div className="card" style={{ padding: '20px 22px' }}>
            <div className="card-header">
              <div>
                <div className="card-title">Classement des comptes</div>
                {f.sort === 'total' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {f.platform === 'all'
                      ? 'Classement all-time — trié par total de vues'
                      : `Classement ${PLATFORM_NAME[f.platform]} — trié par vues ${PLATFORM_NAME[f.platform]}`}
                  </div>
                )}
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{f.filtered.length} compte(s)</div>
            </div>
            <div className="filters-row" style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
              <div className="search-input-wrap" style={{ flex: 1, minWidth: 110 }}>
                <IconSearch size={13} />
                <input className="input" placeholder="Rechercher…" value={f.search} onChange={(e) => f.setSearch(e.target.value)} />
              </div>
              <select className="select" value={f.status} onChange={(e) => f.setStatus(e.target.value)}>
                <option value="all">Statut : tous</option>
                <option value="active">Actifs</option>
                <option value="warning">Placeholders</option>
              </select>
              <select className="select" value={f.platform} onChange={(e) => f.setPlatform(e.target.value)}>
                <option value="all">Plateforme : toutes</option>
                <option value="ig">Instagram</option>
                <option value="tt">TikTok</option>
                <option value="yt">YouTube</option>
              </select>
              <select className="select" value={f.sort} onChange={(e) => f.setSort(e.target.value)}>
                <option value="total">Trier : total</option>
                <option value="nom">Trier : nom</option>
                <option value="croissance">Trier : croissance</option>
              </select>
              {f.active && <button className="btn-link" onClick={f.reset}>Réinitialiser</button>}
            </div>

            <div className="table-scroll">
              <div className="table-header" style={{ gridTemplateColumns: '20px minmax(0,1.3fr) 40px 40px 40px 46px 34px' }}>
                <div>#</div><div className="ellipsis">Compte</div><div>IG</div><div>TT</div><div>YT</div><div>Total</div><div></div>
              </div>
              {f.filtered.map((a, i) => (
                <div
                  key={a.name}
                  className="table-row"
                  style={{ gridTemplateColumns: '20px minmax(0,1.3fr) 40px 40px 40px 46px 34px' }}
                  onClick={() => onOpenDrawer(a.name)}
                >
                  <div className="table-cell-hide-mobile" style={{ fontWeight: 600, color: f.sort === 'total' && i === 0 ? 'var(--orange)' : 'var(--text-muted)', fontSize: 13 }}>
                    {i + 1}
                  </div>
                  <div className="table-cell-title" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</div>
                    {a.isWarning && <div style={{ fontSize: 10.5, color: 'var(--orange)', fontWeight: 600 }}>⚠ 0 vue — placeholder</div>}
                  </div>
                  <div className="mono" data-label="Instagram" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{platformLabel(a.ig)}</div>
                  <div className="mono" data-label="TikTok" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{platformLabel(a.tt)}</div>
                  <div className="mono" data-label="YouTube" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{platformLabel(a.yt)}</div>
                  <div className="mono" data-label="Total" style={{ fontSize: 12.5, fontWeight: 700 }}>{fmtShort(a.total)}</div>
                  <div className="table-cell-hide-mobile">
                    <Sparkline values={a.spark} color={a.growth24h >= 0 ? 'var(--green)' : 'var(--red)'} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="stack">
          {warningsCount > 0 && (
            <div className="card" style={{ background: 'rgba(255,159,10,0.12)', border: '1px solid rgba(255,159,10,0.35)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--orange)' }}>⚠ {warningsCount} compte(s) sans donnée</div>
              <div style={{ fontSize: 12, color: '#d1a45c', lineHeight: 1.5 }}>Aucune vue détectée à la dernière collecte — vérifiez les URLs dans Comptes ou les logs du scraping.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
