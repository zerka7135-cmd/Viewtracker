import { IconDashboard, IconSettings, IconChevronLeft, IconChevronRight, IconLogo } from './icons.jsx';

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
// Pas de bloc "Organisation"/déconnexion ici (version sans auth/multi-
// organisation, voir App.jsx).
export default function Sidebar({ view, onNavigate, collapsed, onToggleCollapsed }) {
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
        >
          {collapsed ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
        </button>
      </div>

      <div className="nav">
        {NAV_ITEMS.map(([key, label, Icon]) => (
          <div
            key={key}
            className={`nav-item ${view === key ? 'active' : ''}`}
            onClick={() => onNavigate(key)}
            title={collapsed ? label : undefined}
          >
            <span className="nav-item-icon"><Icon size={16} /></span>
            <span className="nav-item-label">{label}</span>
          </div>
        ))}
      </div>

    </div>
  );
}
