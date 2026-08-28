import { NAV_ITEMS } from './Sidebar.jsx';

// Barre d'onglets fixée en bas de l'écran — remplace la Sidebar (repliée en
// barre horizontale d'icônes) sous 700px (voir theme.css) : plus proche des
// conventions natives iOS/Android (pouce, zone de confort du bas d'écran)
// qu'une nav en haut d'écran. Seulement visible sur mobile (display: none
// par défaut, voir .mobile-tabbar dans theme.css) — les deux navs restent
// montées en même temps, la media query choisit laquelle s'affiche plutôt
// que de démonter/remonter au resize.
//
// Pas de bouton "Se déconnecter" ici : 3 icônes sur une barre pensée pour
// 2 destinations aurait été plus dense que lisible au pouce — la
// déconnexion reste accessible via Paramètres > Compte (voir
// SettingsView.jsx), y compris sur mobile où la Sidebar est masquée.
export default function MobileTabBar({ view, onNavigate }) {
  return (
    <nav className="mobile-tabbar" aria-label="Navigation principale">
      {NAV_ITEMS.map(([key, label, Icon]) => (
        <button
          key={key}
          type="button"
          className={`mobile-tabbar-item ${view === key ? 'active' : ''}`}
          aria-current={view === key ? 'page' : undefined}
          onClick={() => onNavigate(key)}
        >
          <Icon size={22} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
