import { PERIODS, STANDARD_PERIODS, dateKey } from '../usePeriod.js';
import { IconCalendar } from './icons.jsx';

// Contrôle segmenté de période (voir usePeriod.js) : les options fixes puis
// « Custom » qui déplie deux champs de date. `options` limite les périodes
// proposées (ex. Jour par jour : 1, 7, 14, 30 jours, sans « Tout »).
export default function PeriodSelector({ period, options = STANDARD_PERIODS, custom = true }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 12px', alignItems: 'center', justifyContent: 'flex-end' }}>
      <div className="view-toggle" role="group" aria-label="Période">
        {options.map((key) => (
          <button
            key={key}
            type="button"
            className={`view-toggle-option ${period.key === key ? 'is-active' : ''}`}
            aria-pressed={period.key === key}
            onClick={() => period.setKey(key)}
          >
            {PERIODS[key].label}
          </button>
        ))}
        {custom && (
          <button
            type="button"
            className={`view-toggle-option ${period.key === 'custom' ? 'is-active' : ''}`}
            aria-pressed={period.key === 'custom'}
            onClick={() => period.setKey('custom')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <IconCalendar size={14} /> Custom
          </button>
        )}
      </div>
      {custom && period.key === 'custom' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          <input className="input" type="date" aria-label="Date de début" value={period.custom.from} max={period.custom.to} onChange={(e) => period.setCustom((c) => ({ ...c, from: e.target.value }))} />
          →
          <input className="input" type="date" aria-label="Date de fin" value={period.custom.to} min={period.custom.from} max={dateKey(0)} onChange={(e) => period.setCustom((c) => ({ ...c, to: e.target.value }))} />
        </div>
      )}
      {period.invalid && <div style={{ width: '100%', textAlign: 'right', fontSize: 12, color: 'var(--red)' }}>La date de début dépasse la date de fin.</div>}
    </div>
  );
}
