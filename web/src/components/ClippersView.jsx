import { useEffect, useMemo, useState } from 'react';
import { fmt } from '../format.js';
import { getClippers } from '../api.js';

// Mode « Clics » du Dashboard (toggle Vues/Clics, voir App.jsx) : pour chaque compte suivi et une période, les vues gagnées
// (scraping), les clics, formulaires remplis et cash collecté (envoyés par
// une source externe, voir src/clicksStore.js), et ce qui en découle —
// commission à verser, bénéfice, ROAS (voir src/clippersData.js pour les
// formules).

const TIMEZONE = 'Europe/Paris';

/** Date du jour (YYYY-MM-DD) dans le fuseau du bot, décalée de `daysAgo` jours. */
function dateKey(daysAgo = 0) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - daysAgo)).toISOString().slice(0, 10);
}

const PRESETS = [
  { key: 'today', label: 'Aujourd’hui', range: () => ({ from: dateKey(0), to: dateKey(0) }) },
  { key: '7', label: '7 j', range: () => ({ from: dateKey(6), to: dateKey(0) }) },
  { key: '30', label: '30 j', range: () => ({ from: dateKey(29), to: dateKey(0) }) },
  { key: 'all', label: 'Tout', range: () => ({ from: null, to: null }) }
];

const eur = (n) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const pct = (n) => (n === null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const roasLabel = (n) => (n === null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`);
const profitColor = (n) => (n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text-muted)');

// Colonnes du tableau : `value` sert au tri, `render` à l'affichage. Les
// vues valent `null` quand aucune collecte n'a eu lieu sur la période
// (affichées « — », classées en dernier).
const COLUMNS = [
  { key: 'views', label: 'Vues', width: '84px', value: (r) => r.views, render: (r) => (r.views === null ? '—' : fmt(r.views)) },
  { key: 'clicks', label: 'Clics', width: '72px', value: (r) => r.clicks, render: (r) => fmt(r.clicks) },
  { key: 'forms', label: 'Forms remplis', width: '124px', value: (r) => r.forms, render: (r) => fmt(r.forms) },
  { key: 'optIn', label: 'Opt-in', width: '76px', value: (r) => r.optIn, render: (r) => pct(r.optIn) },
  { key: 'eurPerTraffic', label: '€ / trafic', width: '90px', value: (r) => r.eurPerTraffic, render: (r) => eur(r.eurPerTraffic) },
  { key: 'commission', label: 'Commission', width: '102px', value: (r) => r.commission, render: (r) => eur(r.commission), color: () => 'var(--accent)' },
  { key: 'cash', label: 'Cash collecté', width: '112px', value: (r) => r.cash, render: (r) => eur(r.cash) },
  { key: 'profit', label: 'Bénéfice', width: '102px', value: (r) => r.profit, render: (r) => eur(r.profit), color: (r) => profitColor(r.profit), bold: true }
];

const GRID = `28px minmax(0,1.4fr) ${COLUMNS.map((c) => c.width).join(' ')}`;

function Kpi({ label, value, color, delay }) {
  return (
    <div className="card kpi-card enter-stagger" style={{ '--enter-delay': `${delay}ms` }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: 20, color: color || undefined }}>{value}</div>
    </div>
  );
}

export default function ClippersView({ onToast }) {
  const [presetKey, setPresetKey] = useState('today');
  const [custom, setCustom] = useState({ from: dateKey(6), to: dateKey(0) });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: 'clicks', dir: 'desc' });

  const range = useMemo(() => {
    if (presetKey === 'custom') return custom;
    return PRESETS.find((p) => p.key === presetKey).range();
  }, [presetKey, custom]);

  const rangeInvalid = Boolean(range.from && range.to && range.from > range.to);

  useEffect(() => {
    if (rangeInvalid) return undefined;
    let cancelled = false;
    setLoading(true);
    getClippers(range)
      .then((data) => { if (!cancelled) setReport(data); })
      .catch((err) => { if (!cancelled) onToast(`Erreur : ${err.message}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // onToast change à chaque rendu du parent : le suivre relancerait la requête en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, rangeInvalid]);

  const rows = useMemo(() => {
    if (!report) return [];
    const sorted = [...report.rows];
    const col = sort.key === 'name' ? null : COLUMNS.find((c) => c.key === sort.key);
    const sign = sort.dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      if (!col) return sign * a.name.localeCompare(b.name);
      const va = col.value(a);
      const vb = col.value(b);
      // Valeur absente (—) : toujours en fin de liste, quel que soit le sens.
      if (va === null && vb === null) return a.name.localeCompare(b.name);
      if (va === null) return 1;
      if (vb === null) return -1;
      return sign * (va - vb) || a.name.localeCompare(b.name);
    });
    return sorted;
  }, [report, sort]);

  const toggleSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  };
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? '↓' : '↑') : '↕');
  const ariaSort = (key) => (sort.key === key ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none');

  const kpis = report?.kpis;
  const noClicks = report && kpis.clicks === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="clippers-toolbar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className={`btn period-pill ${presetKey === p.key ? 'is-active' : ''}`} onClick={() => setPresetKey(p.key)}>
              {p.label}
            </button>
          ))}
          <button type="button" className={`btn period-pill ${presetKey === 'custom' ? 'is-active' : ''}`} onClick={() => setPresetKey('custom')}>
            Personnalisé
          </button>
        </div>
        {presetKey === 'custom' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            <input className="input" type="date" aria-label="Date de début" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            →
            <input className="input" type="date" aria-label="Date de fin" value={custom.to} min={custom.from} max={dateKey(0)} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        )}
      </div>

      {rangeInvalid && <div className="card" style={{ padding: 16, color: 'var(--red)', fontSize: 13 }}>La date de début dépasse la date de fin.</div>}

      <div className="kpi-grid kpi-grid-auto">
        <Kpi delay={0} label="Clics" value={kpis ? fmt(kpis.clicks) : '—'} />
        <Kpi delay={40} label="Taux d’opt-in" value={kpis ? pct(kpis.optInRate) : '—'} />
        <Kpi delay={80} label="€ / trafic" value={kpis ? eur(kpis.eurPerTraffic) : '—'} />
        <Kpi delay={120} label="À payer" value={kpis ? eur(kpis.toPay) : '—'} color="var(--accent)" />
        <Kpi delay={160} label="Cash collecté" value={kpis ? eur(kpis.cash) : '—'} />
        <Kpi delay={200} label="Bénéfice" value={kpis ? eur(kpis.profit) : '—'} color={kpis ? profitColor(kpis.profit) : undefined} />
        <Kpi delay={240} label="ROAS" value={kpis ? roasLabel(kpis.roas) : '—'} />
      </div>

      <div className="card clippers-table" style={{ padding: 8, opacity: loading && report ? 0.6 : 1, transition: 'opacity 0.15s' }}>
        <div className="table-scroll">
          <div className="table-header" style={{ gridTemplateColumns: GRID }}>
            <div>#</div>
            <div className="ellipsis" role="columnheader" aria-sort={ariaSort('name')}>
              <span className="sort-head" role="button" tabIndex={0} onClick={() => toggleSort('name')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('name'); } }}>
                Clipper <span aria-hidden="true">{arrow('name')}</span>
              </span>
            </div>
            {COLUMNS.map((c) => (
              <div key={c.key} className="clippers-num" role="columnheader" aria-sort={ariaSort(c.key)}>
                <span className="sort-head" role="button" tabIndex={0} onClick={() => toggleSort(c.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(c.key); } }}>
                  {c.label} <span aria-hidden="true">{arrow(c.key)}</span>
                </span>
              </div>
            ))}
          </div>

          {!report && loading && <div className="table-empty"><div className="table-empty-sub">Chargement…</div></div>}
          {report && rows.length === 0 && (
            <div className="table-empty">
              <div className="table-empty-title">Aucun compte suivi</div>
              <div className="table-empty-sub">Ajoute des comptes depuis le Dashboard pour les voir ici.</div>
            </div>
          )}
          {rows.map((r, i) => (
            <div key={r.name} className="table-row" style={{ gridTemplateColumns: GRID }}>
              <div className="table-cell-hide-mobile" style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 13 }}>{i + 1}</div>
              <div className="table-cell-title ellipsis" style={{ fontWeight: 600, fontSize: 13.5 }}>{r.name}</div>
              {COLUMNS.map((c) => (
                <div key={c.key} className="mono clippers-num" data-label={c.label} style={{ fontSize: 12.5, fontWeight: c.bold ? 700 : 500, color: c.color ? c.color(r) : undefined }}>
                  {c.render(r)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {report && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Commission : {eur(report.commissionPerClick)} par clic (réglable dans Paramètres &gt; Collecte). Bénéfice = cash collecté − commission ; ROAS = cash collecté ÷ commission ; opt-in = formulaires remplis ÷ clics.
          {noClicks && ' Aucun clic reçu sur cette période : les clics, formulaires et le cash sont envoyés par ta source de données (voir POST /api/ingest/clicks).'}
        </div>
      )}
    </div>
  );
}
