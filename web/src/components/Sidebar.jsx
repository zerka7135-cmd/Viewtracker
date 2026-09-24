import { IconDashboard, IconSettings, IconLogo, IconLogout, IconTrophy, IconCalendar, IconUsers } from './icons.jsx';

// "Historique" et "Comptes" ont été fusionnés dans Dashboard (graphique de
// tendance + répartition par plateforme + gestion des comptes suivis —
// voir DashboardView.jsx) : plus d'entrées dédiées, un seul tableau qui
// fait les deux plutôt que deux pages qui affichaient presque la même chose.
// Destinations selon le profil (voir auth.js) : l'admin a tout, le manager
// n'a ni Gestion ni les réglages du bot, le clipper n'a que son Dashboard, le
// Leaderboard et son compte. Exporté : réutilisé par MobileTabBar.jsx, une
// seule liste pour les deux navigations (desktop et mobile).
const DASHBOARD = ['dashboard', 'Dashboard', IconDashboard];
const LEADERBOARD = ['leaderboard', 'Leaderboard', IconTrophy];
const DAILY = ['daily', 'Jour par jour', IconCalendar];
const MANAGEMENT = ['management', 'Gestion', IconUsers];
const SETTINGS = ['settings', 'Paramètres', IconSettings];

export function navItemsFor(role) {
  if (role === 'admin') return [DASHBOARD, LEADERBOARD, DAILY, MANAGEMENT, SETTINGS];
  if (role === 'manager') return [DASHBOARD, LEADERBOARD, DAILY, ['settings', 'Compte', IconSettings]];
  return [DASHBOARD, LEADERBOARD, ['settings', 'Compte', IconSettings]];
}

// Toujours dépliée — plus de bouton de repli (retiré, voir App.jsx : la
// préférence localStorage et le state `collapsed` ont disparu avec lui).
//
// Pas de bloc "Organisation" (version sans multi-organisation, voir
// App.jsx) — juste la déconnexion, un seul mot de passe pour tout le monde.
export default function Sidebar({ role, view, onNavigate, onLogout }) {
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
        {navItemsFor(role).map(([key, label, Icon]) => (
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
