import { useEffect, useState } from 'react';
import { fmtShort, platformLabel } from '../format.js';
import { getHistory, deleteAccount as deleteAccountApi } from '../api.js';
import { useAccountFilters } from '../useAccountFilters.js';
import Sparkline from './Sparkline.jsx';
import AreaChart from './AreaChart.jsx';
import MultiLineChart from './MultiLineChart.jsx';
import CountUp from './CountUp.jsx';
import AddAccountModal from './AddAccountModal.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import { IconSearch, IconEdit, IconTrash, IconPlus, IconCompare } from './icons.jsx';
import AccountComparisonModal from './AccountComparisonModal.jsx';

const PLATFORM_COLOR = { ig: '#e0409e', tt: '#1a93c0', yt: '#ff453a' };
const PLATFORM_NAME = { ig: 'Instagram', tt: 'TikTok', yt: 'YouTube' };
// "24h" ne demande pas une granularité horaire au serveur : la collecte ne
// tourne qu'une fois par jour (cron), donc un vrai découpage par heure
// donnerait 23 points à 0 et un seul pic à l'heure du scan — un graphique
// qui a l'air cassé plutôt qu'informatif. `days: 2` renvoie simplement les
// deux dernières collectes réelles (avant/après), un point de comparaison
// honnête plutôt qu'une granularité fabriquée (voir dataviz : ne jamais
// inventer une résolution qu'on n'a pas).
const CHART_RANGES = [
  { key: '24h', label: '24h', days: 2, isLastScan: true },
  { key: '7', label: '7j', days: 7 },
  { key: '14', label: '14j', days: 14 },
  { key: '30', label: '30j', days: 30 }
];

/** "depuis la dernière collecte" / "14 derniers jours" — pour les titres de graphique. */
function rangeLongLabel(range) {
  return range.isLastScan ? 'depuis la dernière collecte' : `${range.days} derniers jours`;
}
/** "24h" / "14 jours" — pour le texte de tendance ("▲ 12% sur ..."). */
function rangeShortLabel(range) {
  return range.isLastScan ? '24h' : `${range.days} jours`;
}

// Version sans mode Clics (voir backup/dashboard-rewrite-27-08 pour la
// version complète avec suivi de lien en bio) — juste les vues pour
// l'instant.
//
// Page Comptes fusionnée ici (voir Sidebar.jsx) : le classement affiché
// sous le graphique porte maintenant aussi les actions de gestion
// (ajouter/modifier/supprimer un compte) — plus de page séparée qui
// dupliquait presque le même tableau.
export default function DashboardView({ kpis, accounts, onOpenDrawer, onAccountsChanged, onToast }) {
  const [chartRange, setChartRange] = useState(CHART_RANGES[2]); // 14j par défaut
  const [platformSeries, setPlatformSeries] = useState({ ig: [], tt: [], yt: [] });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [deletingAccount, setDeletingAccount] = useState(null);
  const f = useAccountFilters(accounts);

  // Export (CSV/PDF) retiré du tableau global — reste unitaire, compte par
  // compte, depuis le tiroir de détail (voir AccountDrawer.jsx).

  const confirmDelete = async () => {
    try {
      const res = await deleteAccountApi(deletingAccount.name);
      onAccountsChanged(res.accounts);
      onToast(`Compte "${deletingAccount.name}" supprimé`);
      setDeletingAccount(null);
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    }
  };

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
        <div className="card kpi-card enter-stagger" style={{ '--enter-delay': '0ms' }}>
          <div className="kpi-label">Vues totales (cumul)</div>
          <div className="kpi-value"><CountUp value={kpis.totalAllTime} /></div>
          <div className="kpi-sub">sur {kpis.accountsCount} compte{kpis.accountsCount > 1 ? 's' : ''} suivi{kpis.accountsCount > 1 ? 's' : ''}</div>
        </div>
        <div className="card kpi-card enter-stagger" style={{ '--enter-delay': '50ms' }}>
          <div className="kpi-label">Vues gagnées (24h)</div>
          <div className="kpi-value"><CountUp value={kpis.totalGrowth24h} /></div>
          <div className="kpi-sub" style={{ color: 'var(--green)' }}>depuis la dernière collecte</div>
        </div>
        <div className="card kpi-card enter-stagger" style={{ '--enter-delay': '100ms' }}>
          <div className="kpi-label">Comptes suivis</div>
          <div className="kpi-value"><CountUp value={kpis.accountsCount} /></div>
          <div className="kpi-sub" style={{ color: warningsCount ? 'var(--orange)' : 'var(--text-muted)' }}>
            {warningsCount ? `${warningsCount} en attente de configuration` : 'tous configurés'}
          </div>
        </div>
      </div>

      <div className="content-grid">
        <div className="stack">
          <div className="card enter-stagger" style={{ padding: '20px 22px', '--enter-delay': '150ms' }}>
            <div className="card-header">
              <div>
                <div className="card-title">
                  Vues {f.platform === 'all' ? 'totales' : PLATFORM_NAME[f.platform]} — {rangeLongLabel(chartRange)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {f.platform === 'all' ? 'Une ligne par plateforme, même échelle' : `Filtré sur ${PLATFORM_NAME[f.platform]} — ajuste le filtre « Plateforme » ci-dessous pour comparer`}
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
                <MultiLineChart data={combinedChart} colors={PLATFORM_COLOR} />
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

          <div className="card enter-stagger" style={{ padding: '20px 22px', '--enter-delay': '200ms' }}>
            <div className="card-header">
              <div>
                <div className="card-title">Classement des comptes</div>
                {f.sort === 'total' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {f.platform === 'all'
                      ? 'Classement cumulé — trié par total de vues'
                      : `Classement ${PLATFORM_NAME[f.platform]} — trié par vues ${PLATFORM_NAME[f.platform]}`}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{f.filtered.length} compte(s)</div>
                <button type="button" className="btn btn-ghost" onClick={() => setShowCompareModal(true)} disabled={accounts.length < 2} title={accounts.length < 2 ? 'Ajoute au moins 2 comptes pour comparer' : undefined}>
                  <IconCompare size={14} /> Comparer
                </button>
                <button type="button" className="btn btn-accent" onClick={() => setShowAddModal(true)}>
                  <IconPlus size={14} /> Ajouter
                </button>
              </div>
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
              <div className="table-header" style={{ gridTemplateColumns: '20px minmax(0,1.3fr) 40px 40px 40px 46px 34px 64px' }}>
                <div>#</div><div className="ellipsis">Compte</div><div>IG</div><div>TT</div><div>YT</div><div>Total</div><div></div><div></div>
              </div>
              {f.filtered.length === 0 && (
                <div className="table-empty">
                  {accounts.length === 0 ? (
                    <>
                      <div className="table-empty-title">Aucun compte suivi</div>
                      <div className="table-empty-sub">Ajoute un compte Instagram, TikTok ou YouTube pour démarrer le suivi.</div>
                      <button type="button" className="btn btn-accent" onClick={() => setShowAddModal(true)} style={{ marginTop: 12 }}>
                        <IconPlus size={14} /> Ajouter un compte
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="table-empty-title">Aucun résultat</div>
                      <div className="table-empty-sub">Aucun compte ne correspond à ces filtres.</div>
                      {f.active && <button type="button" className="btn-link" onClick={f.reset} style={{ marginTop: 8 }}>Réinitialiser les filtres</button>}
                    </>
                  )}
                </div>
              )}
              {f.filtered.map((a, i) => (
                <div
                  key={a.name}
                  role="button"
                  tabIndex={0}
                  className="table-row"
                  style={{ gridTemplateColumns: '20px minmax(0,1.3fr) 40px 40px 40px 46px 34px 64px' }}
                  onClick={() => onOpenDrawer(a.name)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDrawer(a.name); } }}
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
                  <div className="table-cell-actions" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Modifier" aria-label="Modifier le compte"
                      onClick={(e) => { e.stopPropagation(); setEditingAccount(a); }}
                    >
                      <IconEdit size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      title="Supprimer" aria-label="Supprimer le compte"
                      onClick={(e) => { e.stopPropagation(); setDeletingAccount(a); }}
                    >
                      <IconTrash size={15} />
                    </button>
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
              <div style={{ fontSize: 12, color: '#d1a45c', lineHeight: 1.5 }}>Aucune vue détectée à la dernière collecte — vérifiez les URLs ci-dessus ou les logs du scraping.</div>
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onAdded={onAccountsChanged}
          onToast={onToast}
        />
      )}
      {showCompareModal && (
        <AccountComparisonModal
          accounts={accounts}
          onClose={() => setShowCompareModal(false)}
        />
      )}
      {editingAccount && (
        <AddAccountModal
          account={editingAccount}
          onClose={() => setEditingAccount(null)}
          onAdded={onAccountsChanged}
          onToast={onToast}
        />
      )}
      {deletingAccount && (
        <ConfirmModal
          title="Supprimer le compte"
          message={<>Supprimer <strong>{deletingAccount.name}</strong> ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>Son historique de vues sera perdu, définitivement.</span></>}
          confirmLabel="Supprimer"
          onConfirm={confirmDelete}
          onCancel={() => setDeletingAccount(null)}
        />
      )}
    </div>
  );
}
