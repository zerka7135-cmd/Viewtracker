import { IconLogout } from './icons.jsx';

// Pas d'entrée "accounts" : la page Comptes a été fusionnée dans Dashboard
// (voir DashboardView.jsx) — vue possible désormais : 'dashboard' ou
// 'settings' uniquement (voir Sidebar.jsx#NAV_ITEMS).
const VIEW_META = {
  dashboard: ['Dashboard', 'Classement, tendance et répartition des vues — Instagram, TikTok, YouTube'],
  settings: ['Paramètres', 'Discord, collecte et comptes du dashboard']
};

// Pas de déclenchement de scan depuis le dashboard : la collecte reste
// pilotée uniquement par le cron planifié (voir src/index.js).
//
// `actions` : contenu optionnel affiché à droite, sur la même ligne que le
// titre (ex. l'indicateur de scan du Dashboard, voir ScanStatusIndicator.jsx/
// App.jsx) — vide sur les autres pages.
//
// `onLogout` : la Sidebar porte déjà la déconnexion, mais elle est masquée
// sous 700px au profit de MobileTabBar.jsx (juste la nav, pas de place pour
// un 3e bouton dans une barre pensée pour 2 destinations) — ce bouton
// couvre ce cas, affiché uniquement sur mobile via .topbar-logout dans
// theme.css (display: none par défaut, visible sous 700px).
export default function TopBar({ view, actions, onLogout }) {
  const [title, subtitle] = VIEW_META[view];

  return (
    <div className="topbar">
      <div>
        <div className="topbar-title">{title}</div>
        <div className="topbar-subtitle">{subtitle}</div>
      </div>
      <div className="topbar-actions">
        {actions}
        <button type="button" className="icon-btn topbar-logout" title="Se déconnecter" aria-label="Se déconnecter" onClick={onLogout}>
          <IconLogout size={17} />
        </button>
      </div>
    </div>
  );
}
