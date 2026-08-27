import { IconDashboard, IconSettings, IconChevronLeft, IconChevronRight, IconLogo, IconLogout } from './icons.jsx';

// "Historique" et "Comptes" ont été fusionnés dans Dashboard (graphique de
// tendance + répartition par plateforme + gestion des comptes suivis —
// voir DashboardView.jsx) : plus d'entrées dédiées, un seul tableau qui
// fait les deux plutôt que deux pages qui affichaient presque la même chose.
const NAV_ITEMS = [
  ['dashboard', 'Dashboard', IconDashboard],
  ['settings', 'Paramètres', IconSettings]
];

// `collapsed` est répercuté par App.jsx (préférence persistée en
// localStorage) — replie la sidebar à une colonne d'icônes, le bouton de
// bascule restant sur la même ligne que le logo.
//
// Les libellés (nom de l'app, des pages…) restent toujours montés dans le
// DOM — seule leur taille/opacité change via CSS (voir theme.css) — pour
// que le repli soit une transition fluide plutôt qu'une disparition
// brutale du texte pendant que la largeur anime encore.
//
// Pas de bloc "Organisation" (version sans multi-organisation, voir
// App.jsx) — juste la déconnexion, un seul mot de passe pour tout le monde.
export default function Sidebar({ view, onNavigate, collapsed, onToggleCollapsed, onLogout }) {
  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark"><IconLogo style={{ width: '60%', height: '60%' }} /></div>
        <div className="sidebar-brand-name">ViewTracker</div>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Déplier la navigation' : 'Replier la navigation'}
          aria-label={collapsed ? 'Déplier la navigation' : 'Replier la navigation'}
        >
          {collapsed ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
        </button>
      </div>

      {/* role="button"+tabIndex+onKeyDown : un <div onClick> seul n'est ni
          focusable au clavier ni activable par Entrée/Espace — c'était le
          cas ici (nav principale entièrement hors de portée du clavier). */}
      <div className="nav">
        {NAV_ITEMS.map(([key, label, Icon]) => (
          <div
            key={key}
            role="button"
            tabIndex={0}
            aria-current={view === key ? 'page' : undefined}
            className={`nav-item ${view === key ? 'active' : ''}`}
            onClick={() => onNavigate(key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(key); } }}
            title={collapsed ? label : undefined}
          >
            <span className="nav-item-icon"><Icon size={16} /></span>
            <span className="nav-item-label">{label}</span>
          </div>
        ))}
      </div>

      <button type="button" className="sidebar-logout" onClick={onLogout} title={collapsed ? 'Se déconnecter' : undefined}>
        <IconLogout size={16} />
        <span className="nav-item-label">Se déconnecter</span>
      </button>
    </div>
  );
}
