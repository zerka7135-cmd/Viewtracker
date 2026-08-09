import { useEffect, useState } from 'react';
import { fmt, fmtShort, platformLabel } from '../format.js';
import { getHistory, getClicksHistory } from '../api.js';
import { useAccountFilters } from '../useAccountFilters.js';
import AreaChart from './AreaChart.jsx';
import Sparkline from './Sparkline.jsx';
import { IconSearch, IconCopy } from './icons.jsx';

const PLATFORM_COLOR = { ig: '#e0409e', tt: '#00c2c7', yt: '#ff453a' };
const PLATFORM_NAME = { ig: 'Instagram', tt: 'TikTok', yt: 'YouTube' };
// `hours` (24h) vs `days` — deux granularités différentes côté serveur
// (voir getHistorySeriesHourly/getClicksHistorySeriesHourly), la collecte
// horaire n'a de sens que sur les dernières 24h.
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

// `mode` ("views"/"clicks") et le repère de fraîcheur (scan) sont affichés
// dans TopBar (voir App.jsx/ScanStatusIndicator.jsx/ModeToggle.jsx), sur
// la même ligne que le titre "Dashboard" — plus ici.
export default function DashboardView({ kpis, accounts, mode, onOpenDrawer, onToast }) {
  const [chartRange, setChartRange] = useState(CHART_RANGES[2]); // 14j par défaut
  const [platformSeries, setPlatformSeries] = useState({ ig: [], tt: [], yt: [] });
  const f = useAccountFilters(accounts);

  // Une seule requête (les 3 séries par plateforme) alimente le graphique
  // fusionné "Vues" ci-dessous : en filtre "Plateforme : toutes", les
  // barres empilées montrent à la fois la tendance (hauteur totale) et la
  // répartition (couleurs) ; en filtrant une plateforme précise, seule sa
  // courbe est affichée. Un seul chargement réseau plutôt que deux
  // endpoints séparés pour la tendance et la répartition.
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

  // Vue "toutes plateformes" (barres empilées, une couleur par réseau) vs
  // vue "une plateforme" (courbe simple, tooltip au survol — voir AreaChart).
  const chartData = combinedChart.map((d) => ({ date: d.date, value: f.platform === 'all' ? d.total : d[f.platform] }));
  const maxTotal = Math.max(...combinedChart.map((d) => d.total), 1);

  const trendPct = chartData.length >= 2 && chartData[0].value > 0
    ? ((chartData[chartData.length - 1].value - chartData[0].value) / chartData[0].value) * 100
    : 0;

  // Graphique "Clics totaux" (mode Clics) — mêmes filtres période/plateforme
  // que le graphique de vues. "Plateforme" filtre ici les comptes ayant
  // cette plateforme configurée (un lien en bio est unique par compte, pas
  // par réseau — voir getClicksHistorySeries côté serveur).
  const [clicksChartData, setClicksChartData] = useState([]);
  const showViews = mode === 'views' || mode === 'all';
  const showClicks = mode === 'clicks' || mode === 'all';
  useEffect(() => {
    if (!showClicks) return;
    let cancelled = false;
    getClicksHistory(chartRange, f.platform).then((res) => { if (!cancelled) setClicksChartData(res.series); }).catch(() => { if (!cancelled) setClicksChartData([]); });
    return () => { cancelled = true; };
  }, [showClicks, chartRange, f.platform]);

  const clicksTrendPct = clicksChartData.length >= 2 && clicksChartData[0].value > 0
    ? ((clicksChartData[clicksChartData.length - 1].value - clicksChartData[0].value) / clicksChartData[0].value) * 100
    : 0;

  const warningsCount = kpis.warningsCount;

  const copyTrackedLink = (url) => {
    navigator.clipboard.writeText(url)
      .then(() => onToast?.('Lien copié'))
      .catch(() => onToast?.('Impossible de copier le lien'));
  };

  // Classement par clics — même logique de recherche/plateforme que
  // useAccountFilters, mais trié par clics plutôt que par vues (le lien
  // en bio reste unique par compte, donc "plateforme" filtre les comptes
  // plutôt que de distinguer un clic par réseau — voir bioLink.js).
  const clicksRanked = [...accounts]
    .filter((a) => a.name.toLowerCase().includes(f.search.toLowerCase()))
    .filter((a) => (f.platform === 'all' ? true : a[f.platform] !== null))
    .sort((a, b) => (b.bioLink?.clicks || 0) - (a.bioLink?.clicks || 0));

  // Sur "Tous", les deux sections passent en 2 colonnes côte à côte (voir
  // le return plus bas) plutôt qu'empilées — d'où l'extraction en
  // variables JSX ici : le même contenu est réutilisé dans les deux
  // dispositions (empilée pour Vues/Clics seuls, 2 colonnes pour "Tous")
  // sans dupliquer le JSX.
  const viewsKpiGrid = (
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
          <div className="card kpi-card">
            <div className="kpi-label">Statut du scraping</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
              {Object.entries(PLATFORM_COLOR).map(([key, color]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={key === 'ig' ? 'Instagram' : key === 'tt' ? 'TikTok' : 'YouTube'}>
                  <div className="dot" style={{ background: color }} />
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{key.toUpperCase()}</div>
                </div>
              ))}
            </div>
            <div className="kpi-sub" style={{ color: 'var(--green)' }}>tout est OK</div>
          </div>
        </div>
  );

  const clicksKpiGrid = (
        <div className="kpi-grid">
          <div className="card kpi-card">
            <div className="kpi-label">Clics totaux (all-time)</div>
            <div className="kpi-value">{fmt(kpis.totalClicks)}</div>
            <div className="kpi-sub">sur les liens en bio suivis</div>
          </div>
          <div className="card kpi-card">
            <div className="kpi-label">Taux de conversion</div>
            <div className="kpi-value">{kpis.conversionRate.toFixed(2)}%</div>
            <div className="kpi-sub">clics ÷ vues, toutes plateformes</div>
          </div>
          <div className="card kpi-card">
            <div className="kpi-label">Liens configurés</div>
            <div className="kpi-value">{kpis.linksConfiguredCount}</div>
            <div className="kpi-sub" style={{ color: kpis.linksConfiguredCount < kpis.accountsCount ? 'var(--orange)' : 'var(--text-muted)' }}>
              sur {kpis.accountsCount} comptes suivis
            </div>
          </div>
        </div>
  );

  const viewsContent = (
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
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 150 }}>
                    {combinedChart.map((d) => (
                      <div key={d.date} title={`${fmt(d.total)} vues`} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                        <div
                          style={{
                            width: '100%', height: `${(d.total / maxTotal) * 100}%`, minHeight: d.total > 0 ? 2 : 0,
                            display: 'flex', flexDirection: 'column-reverse', borderRadius: 3, overflow: 'hidden'
                          }}
                        >
                          <div style={{ height: d.total ? `${(d.ig / d.total) * 100}%` : '0%', background: PLATFORM_COLOR.ig }} />
                          <div style={{ height: d.total ? `${(d.tt / d.total) * 100}%` : '0%', background: PLATFORM_COLOR.tt }} />
                          <div style={{ height: d.total ? `${(d.yt / d.total) * 100}%` : '0%', background: PLATFORM_COLOR.yt }} />
                        </div>
                      </div>
                    ))}
                    {combinedChart.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pas encore de données.</div>}
                  </div>
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
  );

  const clicksContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card" style={{ padding: '20px 22px' }}>
            <div className="card-header">
              <div className="card-title">
                Clics {f.platform === 'all' ? 'totaux' : PLATFORM_NAME[f.platform]} — {rangeLongLabel(chartRange)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: clicksTrendPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {clicksTrendPct >= 0 ? '▲' : '▼'} {Math.abs(clicksTrendPct).toFixed(1)}% sur {rangeShortLabel(chartRange)}
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
            <AreaChart data={clicksChartData} color={f.platform === 'all' ? 'var(--accent)' : PLATFORM_COLOR[f.platform]} />
          </div>

          <div className="card" style={{ padding: '20px 22px' }}>
          <div className="card-header">
            <div>
              <div className="card-title">Classement par clics</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Conversion des liens en bio — trié par nombre de clics</div>
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{clicksRanked.length} compte(s)</div>
          </div>
          <div className="filters-row" style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
            <div className="search-input-wrap" style={{ flex: 1, minWidth: 110 }}>
              <IconSearch size={13} />
              <input className="input" placeholder="Rechercher…" value={f.search} onChange={(e) => f.setSearch(e.target.value)} />
            </div>
            <select className="select" value={f.platform} onChange={(e) => f.setPlatform(e.target.value)}>
              <option value="all">Plateforme : toutes</option>
              <option value="ig">Instagram</option>
              <option value="tt">TikTok</option>
              <option value="yt">YouTube</option>
            </select>
            {(f.search || f.platform !== 'all') && <button className="btn-link" onClick={f.reset}>Réinitialiser</button>}
          </div>

          <div className="table-scroll">
            <div className="table-header" style={{ gridTemplateColumns: '20px minmax(0,1.2fr) minmax(0,1.6fr) 70px 90px 32px' }}>
              <div>#</div><div className="ellipsis">Compte</div><div>Lien en bio</div><div>Clics</div><div>Conversion</div><div></div>
            </div>
            {clicksRanked.map((a, i) => {
              const clicks = a.bioLink?.clicks || 0;
              const conversion = a.total > 0 ? (clicks / a.total) * 100 : 0;
              return (
                <div
                  key={a.name}
                  className="table-row"
                  style={{ gridTemplateColumns: '20px minmax(0,1.2fr) minmax(0,1.6fr) 70px 90px 32px' }}
                  onClick={() => onOpenDrawer(a.name)}
                >
                  <div className="table-cell-hide-mobile" style={{ fontWeight: 600, color: i === 0 && clicks > 0 ? 'var(--orange)' : 'var(--text-muted)', fontSize: 13 }}>
                    {i + 1}
                  </div>
                  <div className="table-cell-title ellipsis" style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</div>
                  <div className="mono ellipsis" data-label="Lien" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    {a.bioLink?.trackedUrl || <span style={{ color: 'var(--text-muted)' }}>Non configuré</span>}
                  </div>
                  <div className="mono" data-label="Clics" style={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(clicks)}</div>
                  <div className="mono" data-label="Conversion" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{conversion.toFixed(1)}%</div>
                  <div className="table-cell-actions" style={{ justifyContent: 'flex-end' }}>
                    {a.bioLink?.trackedUrl && (
                      <button
                        type="button"
                        className="icon-btn"
                        title="Copier le lien"
                        onClick={(e) => { e.stopPropagation(); copyTrackedLink(a.bioLink.trackedUrl); }}
                      >
                        <IconCopy size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {clicksRanked.length === 0 && (
              <div style={{ padding: '24px 8px', color: 'var(--text-muted)', fontSize: 13 }}>Aucun compte ne correspond à cette recherche.</div>
            )}
          </div>
          </div>
        </div>
  );

  // "Tous" : Vues et Clics affichés en 2 colonnes côte à côte plutôt
  // qu'empilés, chaque colonne gardant sa propre carte KPI + graphique +
  // tableau (le nested content-grid des Vues se resserre à l'intérieur de
  // sa moitié — le tableau garde son scroll horizontal, voir .table-scroll).
  if (mode === 'all') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            {viewsKpiGrid}
            {viewsContent}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            {clicksKpiGrid}
            {clicksContent}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {showViews && viewsKpiGrid}
      {showClicks && clicksKpiGrid}
      {showViews && viewsContent}
      {showClicks && clicksContent}
    </div>
  );
}
