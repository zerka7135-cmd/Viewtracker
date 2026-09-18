import { IconDashboard, IconSettings, IconLogo, IconLogout } from './icons.jsx';

// "Historique" et "Comptes" ont été fusionnés dans Dashboard (graphique de
// tendance + répartition par plateforme + gestion des comptes suivis —
// voir DashboardView.jsx) : plus d'entrées dédiées, un seul tableau qui
// fait les deux plutôt que deux pages qui affichaient presque la même chose.
// Exporté : réutilisé tel quel par MobileTabBar.jsx, une seule liste de
// destinations pour les deux navigations (desktop et mobile).
export const NAV_ITEMS = [
  ['dashboard', 'Dashboard', IconDashboard],
  ['settings', 'Paramètres', IconSettings]
];

// Toujours dépliée — plus de bouton de repli (retiré, voir App.jsx : la
// préférence localStorage et le state `collapsed` ont disparu avec lui).
//
// Pas de bloc "Organisation" (version sans multi-organisation, voir
// App.jsx) — juste la déconnexion, un seul mot de passe pour tout le monde.
export default function Sidebar({ view, onNavigate, onLogout }) {
  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark"><IconLogo style={{ width: '60%', height: '60%' }} /></div>
        <div className="sidebar-brand-name">ViewTracker</div>
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
          >
            <span className="nav-item-icon"><Icon size={16} /></span>
            <span className="nav-item-label">{label}</span>
          </div>
        ))}
      </div>

      <button type="button" className="sidebar-logout" onClick={onLogout}>
        <IconLogout size={16} />
        <span className="nav-item-label">Se déconnecter</span>
      </button>
    </div>
  );
}
