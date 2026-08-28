import { useEffect, useMemo, useState } from 'react';
import { getAccountHistory } from '../api.js';
import { fmt, fmtShort } from '../format.js';
import MultiLineChart from './MultiLineChart.jsx';
import CloseButton from './CloseButton.jsx';
import { useEscapeKey } from '../useEscapeKey.js';
import { IconSearch, IconFile } from './icons.jsx';
import { downloadPdf } from '../pdf.js';

const MAX_COMPARE = 4;
const RANGES = [7, 14, 30];
// 4 teintes catégorielles validées ensemble (dataviz skill — palette
// référence, slots dark 1/2/3/4) : jamais recyclées, une couleur par
// emplacement de sélection (1er compte coché = couleur 1, etc.), pas par
// plateforme puisqu'on compare des comptes ici. Distinctes de --ig/--tt/--yt
// pour ne pas laisser croire à un lien avec une plateforme en particulier.
const COMPARE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500'];

/**
 * Superpose l'évolution "total" de 2 à 4 comptes suivis sur un même
 * graphique (même principe que MultiLineChart pour les plateformes, voir
 * ce composant) — pour comparer la progression de plusieurs comptes plutôt
 * que de naviguer leurs tiroirs de détail un par un.
 */
export default function AccountComparisonModal({ accounts, onClose, onToast }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [days, setDays] = useState(14);
  const [seriesByName, setSeriesByName] = useState({});
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEscapeKey(onClose);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return accounts.filter((a) => a.name.toLowerCase().includes(q));
  }, [accounts, search]);

  const toggle = (name) => {
    setSelected((sel) => {
      if (sel.includes(name)) return sel.filter((n) => n !== name);
      if (sel.length >= MAX_COMPARE) return sel;
      return [...sel, name];
    });
  };

  useEffect(() => {
    if (selected.length === 0) return;
    let cancelled = false;
    setLoading(true);
    Promise.all(selected.map((name) => getAccountHistory(name, days, 'all').then((res) => [name, res.series])))
      .then((pairs) => {
        if (cancelled) return;
        setSeriesByName(Object.fromEntries(pairs));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, days]);

  // Séries au format attendu par MultiLineChart : une entrée par date, une
  // clé par compte sélectionné (voir dashboardData.js#getAccountHistorySeries
  // — `value` vaut null tant que le compte n'a pas encore de donnée sur ce
  // jour, converti en 0 ici pour l'affichage, comme AreaChart.jsx le fait
  // déjà pour le tiroir de détail).
  const chartSeries = selected.map((name, i) => [name, name, COMPARE_COLORS[i]]);
  const chartData = useMemo(() => {
    if (selected.length === 0) return [];
    const dates = seriesByName[selected[0]]?.map((d) => d.date) || [];
    return dates.map((date, i) => {
      const row = { date };
      for (const name of selected) row[name] = seriesByName[name]?.[i]?.value ?? 0;
      return row;
    });
  }, [selected, seriesByName]);
  const colors = Object.fromEntries(chartSeries.map(([key, , color]) => [key, color]));
  const seriesForChart = chartSeries.map(([key, label]) => [key, label]);

  // Tableau date x comptes (une colonne par compte sélectionné) — le
  // rapport le plus utile ici est la comparaison ligne à ligne, pas une
  // série par compte à part (qui obligerait à recouper les dates à la main
  // pour comparer deux comptes sur un même jour).
  const exportPdf = async () => {
    setExporting(true);
    try {
      const summary = selected.map((name, i) => [name, fmt(chartData[chartData.length - 1]?.[name] ?? 0)]);
      const rows = chartData.map((row) => [row.date, ...selected.map((name) => row[name])]);
      await downloadPdf(
        `viewtracker-comparaison-${new Date().toISOString().slice(0, 10)}`,
        'Comparaison de comptes',
        `${selected.join(', ')} — ${days} derniers jours`,
        summary,
        ['Date', ...selected],
        rows
      );
    } catch (err) {
      onToast(`Erreur export PDF : ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="modal">
        <div className="card modal-card" style={{ width: 640, maxWidth: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Comparer des comptes</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Choisis {MAX_COMPARE === 4 ? '2 à 4' : `jusqu'à ${MAX_COMPARE}`} comptes pour superposer leur évolution.
              </div>
            </div>
            <CloseButton onClick={onClose} />
          </div>

          <div className="search-input-wrap">
            <IconSearch size={13} />
            <input className="input" placeholder="Rechercher un compte…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%' }} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto', padding: '2px 0' }}>
            {filtered.map((a) => {
              const isSelected = selected.includes(a.name);
              const colorIndex = selected.indexOf(a.name);
              return (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => toggle(a.name)}
                  disabled={!isSelected && selected.length >= MAX_COMPARE}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', borderRadius: 980, fontSize: 12, fontWeight: 600,
                    border: `1px solid ${isSelected ? COMPARE_COLORS[colorIndex] : 'var(--border-strong)'}`,
                    background: isSelected ? `color-mix(in oklab, ${COMPARE_COLORS[colorIndex]} 18%, transparent)` : 'transparent',
                    color: isSelected ? 'var(--text)' : 'var(--text-faint)',
                    cursor: !isSelected && selected.length >= MAX_COMPARE ? 'not-allowed' : 'pointer',
                    opacity: !isSelected && selected.length >= MAX_COMPARE ? 0.5 : 1
                  }}
                >
                  {isSelected && <span style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARE_COLORS[colorIndex], flexShrink: 0 }} />}
                  {a.name}
                </button>
              );
            })}
            {filtered.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>Aucun compte ne correspond à cette recherche.</div>}
          </div>

          {selected.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                {RANGES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="btn"
                    onClick={() => setDays(d)}
                    style={{
                      padding: '5px 10px', borderRadius: 980, fontSize: 11, fontWeight: 600,
                      border: `1px solid ${d === days ? 'var(--accent)' : 'var(--border-strong)'}`,
                      background: d === days ? 'var(--accent)' : 'transparent',
                      color: d === days ? '#fff' : 'var(--text-faint)'
                    }}
                  >
                    {d}j
                  </button>
                ))}
                <button
                  type="button"
                  className="icon-btn"
                  title="Exporter la comparaison en PDF"
                  aria-label="Exporter la comparaison en PDF"
                  onClick={exportPdf}
                  disabled={exporting || chartData.length === 0}
                >
                  {exporting ? <span className="login-spinner" /> : <IconFile size={14} />}
                </button>
              </div>

              <div style={{ background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
                {loading ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '30px 0', textAlign: 'center' }}>Chargement…</div>
                ) : (
                  <MultiLineChart data={chartData} colors={colors} series={seriesForChart} height={160} />
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                {selected.map((name, i) => {
                  const last = chartData[chartData.length - 1]?.[name] ?? 0;
                  return (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARE_COLORS[i] }} />
                      <span style={{ color: 'var(--text-faint)' }}>{name}</span>
                      <span className="mono" style={{ fontWeight: 700 }}>{fmtShort(last)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {selected.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
              Sélectionne au moins un compte ci-dessus pour voir son évolution.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
