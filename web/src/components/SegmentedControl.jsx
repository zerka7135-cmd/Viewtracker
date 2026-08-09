// Toggle segmenté générique (style iOS/Apple : un seul conteneur, un fond
// qui glisse derrière l'option active) — utilisé pour Vues/Clics
// (ModeToggle.jsx) et pour Sombre/Clair (SettingsView.jsx). `options` :
// [[value, label], ...].
export default function SegmentedControl({ options, value, onChange, style }) {
  const activeIndex = Math.max(0, options.findIndex(([key]) => key === value));
  const count = options.length;

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        background: 'var(--card-alt)',
        border: '1px solid var(--border)',
        borderRadius: 980,
        padding: 3,
        ...style
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 3,
          bottom: 3,
          left: 3,
          width: `calc(${100 / count}% - ${6 / count}px)`,
          borderRadius: 980,
          background: 'var(--accent)',
          transform: `translateX(${activeIndex * 100}%)`,
          transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      />
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          style={{
            position: 'relative',
            zIndex: 1,
            flex: 1,
            padding: '6px 14px',
            border: 'none',
            background: 'transparent',
            borderRadius: 980,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            color: value === key ? '#fff' : 'var(--text-faint)',
            transition: 'color 0.2s ease'
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
