// Bascule Vues / Clics du Dashboard : « Vues » = classement et tendance des
// vues scrapées (DashboardView), « Clics » = clics, formulaires, cash et
// bénéfice par clipper (ClippersView). role="group" + aria-pressed portent
// l'état pour les lecteurs d'écran.
const OPTIONS = [['views', 'Vues'], ['clicks', 'Clics']];

export default function ViewsClicksToggle({ mode, onChange }) {
  return (
    <div className="view-toggle" role="group" aria-label="Afficher les vues ou les clics">
      {OPTIONS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`view-toggle-option ${mode === key ? 'is-active' : ''}`}
          aria-pressed={mode === key}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
