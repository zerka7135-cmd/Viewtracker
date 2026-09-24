import { useEffect, useMemo, useState } from 'react';
import { fmt, eur, pct, roasLabel } from '../format.js';
import { getClippers } from '../api.js';
import { usePeriod } from '../usePeriod.js';
import PeriodSelector from './PeriodSelector.jsx';
import Bone from './Bone.jsx';

// Mode « Clics » du Dashboard (toggle Vues/Clics, voir App.jsx) : « Tous les
// clippers » — pour chaque compte suivi et une période, les vues gagnées
// (scraping) et, venus de Supabase (voir src/supabaseSync.js), les clics,
// formulaires remplis, € / trafic et commission. L'admin voit en plus le cash
// collecté et le bénéfice ; le manager n'a pas ces colonnes : c'est le serveur
// qui ne les envoie pas (voir src/clippersData.js), pas l'interface qui les
// masque.

const profitColor = (n) => (n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text-muted)');

// `value` sert au tri, `render` à l'affichage. Les vues valent `null` quand
// aucune collecte n'a eu lieu sur la période (« — », classées en dernier).
const BASE_COLUMNS = [
  { key: 'views', label: 'Vues', width: '84px', value: (r) => r.views, render: (r) => (r.views === null ? '—' : fmt(r.views)), muted: true },
  { key: 'clicks', label: 'Clics', width: '72px', value: (r) => r.clicks, render: (r) => fmt(r.clicks) },
  { key: 'forms', label: 'Forms remplis', width: '124px', value: (r) => r.forms, render: (r) => fmt(r.forms) },
  { key: 'optIn', label: 'Opt-in', width: '76px', value: (r) => r.optIn, render: (r) => pct(r.optIn) },
  { key: 'eurPerTraffic', label: '€ / trafic', width: '90px', value: (r) => r.eurPerTraffic, render: (r) => eur(r.eurPerTraffic) },
  { key: 'commission', label: 'Commission', width: '102px', value: (r) => r.commission, render: (r) => eur(r.commission), color: () => 'var(--accent)' }
];
const ADMIN_COLUMNS = [
  { key: 'cash', label: 'Cash collecté', width: '112px', value: (r) => r.cash, render: (r) => eur(r.cash) },
  { key: 'profit', label: 'Bénéfice', width: '102px', value: (r) => r.profit, render: (r) => eur(r.profit), color: (r) => profitColor(r.profit), bold: true }
];

function Kpi({ label, value, color, delay, className, loading }) {
  return (
    <div className={`card kpi-card enter-stagger ${className || ''}`} style={{ '--enter-delay': `${delay}ms` }}>
      <div className="kpi-label">{label}</div>
      {loading ? <Bone w={84} h={22} style={{ marginTop: 2 }} /> : <div className="kpi-value" style={{ fontSize: 20, color: color || undefined }}>{value}</div>}
    </div>
  );
}

export default function ClippersView({ role, onOpenClipper, onOpenManagement, onToast }) {
  const isAdmin = role === 'admin';
  // Périodes par défaut des écrans de référence : admin sur « Aujourd'hui », manager sur 7 j.
  const period = usePeriod(isAdmin ? 'today' : '7');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: 'clicks', dir: 'desc' });

  const columns = useMemo(() => (isAdmin ? [...BASE_COLUMNS, ...ADMIN_COLUMNS] : BASE_COLUMNS), [isAdmin]);
  const grid = `28px minmax(0,1.4fr) ${columns.map((c) => c.width).join(' ')}`;

  useEffect(() => {
    if (period.invalid) return undefined;
    let cancelled = false;
    setLoading(true);
    getClippers(period.range)
      .then((data) => { if (!cancelled) setReport(data); })
      .catch((err) => { if (!cancelled) onToast(`Erreur : ${err.message}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // onToast change à chaque rendu du parent : le suivre relancerait la requête en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.range.from, period.range.to, period.invalid]);

  const rows = useMemo(() => {
    if (!report) return [];
    const sorted = [...report.rows];
    const col = sort.key === 'name' ? null : columns.find((c) => c.key === sort.key);
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
  }, [report, sort, columns]);

  const toggleSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  };
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? '↓' : '↑') : '↕');
  const ariaSort = (key) => (sort.key === key ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none');
  const sortProps = (key) => ({
    role: 'button',
    tabIndex: 0,
    onClick: () => toggleSort(key),
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(key); } }
  });

  const k = report?.kpis;
  const pending = !report; // premier chargement : formes grises à la place des chiffres
  const noClicks = report && (isAdmin ? k.clicks === 0 : rows.every((r) => r.clicks === 0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PeriodSelector period={period} />

      <div className="kpi-grid kpi-grid-auto">
        {isAdmin ? (
          <>
            <Kpi loading={pending} delay={0} label="Clics" value={k && fmt(k.clicks)} />
            <Kpi loading={pending} delay={40} label="Taux d’opt-in" value={k && pct(k.optInRate)} />
            <Kpi loading={pending} delay={80} label="€ / trafic" value={k && eur(k.eurPerTraffic)} />
            <Kpi loading={pending} delay={120} label="À payer" value={k && eur(k.toPay)} color="var(--accent)" />
            <Kpi loading={pending} delay={160} label="Cash collecté" value={k && eur(k.cash)} />
            <Kpi loading={pending} delay={200} label="Bénéfice" value={k && eur(k.profit)} color={k ? profitColor(k.profit) : undefined} />
            <Kpi loading={pending} delay={240} label="ROAS" value={k && roasLabel(k.roas)} color={k && k.roas !== null && k.roas < 1 ? 'var(--red)' : undefined} />
          </>
        ) : (
          <>
            <Kpi loading={pending} delay={0} label="Clippers" value={k && fmt(k.clippers)} />
            <Kpi loading={pending} delay={40} label="Clics" value={k && fmt(k.clicks)} />
            <Kpi loading={pending} delay={80} label="Taux d’opt-in" value={k && pct(k.optInRate)} />
            <Kpi loading={pending} delay={120} label="€ / trafic" value={k && eur(k.eurPerTraffic)} />
            <Kpi loading={pending} delay={160} label="Commissions" value={k && eur(k.commissions)} color="var(--accent)" />
          </>
        )}
      </div>

      {noClicks && (
        <div className="info-banner" role="status">
          <span>Aucun clic sur cette période. Les clics, formulaires et le cash arrivent par la synchronisation Supabase.</span>
          {onOpenManagement && <button type="button" className="btn btn-ghost" style={{ borderRadius: 980 }} onClick={onOpenManagement}>Vérifier la synchronisation</button>}
        </div>
      )}

      <div className="card clippers-table" style={{ padding: 8, opacity: loading && report ? 0.6 : 1, transition: 'opacity 0.15s' }}>
        <div className="table-scroll">
          <div className="table-header" style={{ gridTemplateColumns: grid }}>
            <div>#</div>
            <div className="ellipsis" role="columnheader" aria-sort={ariaSort('name')}>
              <span className="sort-head" {...sortProps('name')}>Clipper <span aria-hidden="true">{arrow('name')}</span></span>
            </div>
            {columns.map((c) => (
              <div key={c.key} className="clippers-num" role="columnheader" aria-sort={ariaSort(c.key)}>
                <span className="sort-head" {...sortProps(c.key)}>{c.label} <span aria-hidden="true">{arrow(c.key)}</span></span>
              </div>
            ))}
          </div>

          {pending && Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="table-row" style={{ gridTemplateColumns: grid, cursor: 'default' }} aria-hidden="true">
              <Bone w={14} h={12} />
              <Bone w="60%" h={14} />
              {columns.map((c) => <Bone key={c.key} w={48} h={12} style={{ justifySelf: 'end' }} />)}
            </div>
          ))}
          {report && rows.length === 0 && (
            <div className="table-empty">
              <div className="table-empty-title">Aucun clipper pour l'instant</div>
              <div className="table-empty-sub">{isAdmin ? 'Aucun clipper n’a de clic sur cette période.' : 'Aucun compte suivi.'}</div>
            </div>
          )}
          {rows.map((r, i) => (
            <div key={r.name} className="table-row" style={{ gridTemplateColumns: grid }}>
              <div className="table-cell-hide-mobile" style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 13 }}>{i + 1}</div>
              <div className="table-cell-title ellipsis" style={{ fontSize: 13.5 }}>
                <button type="button" className="clipper-link" style={{ fontSize: 13.5 }} onClick={() => onOpenClipper(r.name)}>
                  {r.name}
                </button>
              </div>
              {columns.map((c) => (
                <div key={c.key} className="mono clippers-num" data-label={c.label} style={{ fontSize: 12.5, fontWeight: c.bold ? 700 : 500, color: c.color ? c.color(r) : c.muted ? 'var(--text-muted)' : undefined }}>
                  {c.render(r)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {report && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Commission = clics × tarif par clic de chaque clipper (par défaut {eur(report.commissionPerClick)}). Opt-in = formulaires remplis ÷ clics.
          {isAdmin && ` Cash converti en euros (× ${report.cashConversionRate.toLocaleString('fr-FR')}). Bénéfice = cash collecté − commission ; ROAS = cash collecté ÷ commission.`}
        </div>
      )}
    </div>
  );
}
