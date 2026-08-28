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
// App.jsx) — vide sur les autres pages. Pas de bouton de déconnexion ici :
// la Sidebar le porte déjà (voir aussi Paramètres > Compte sur mobile, où
// la Sidebar est masquée — voir SettingsView.jsx).
export default function TopBar({ view, actions }) {
  const [title, subtitle] = VIEW_META[view];

  return (
    <div className="topbar">
      <div>
        <div className="topbar-title">{title}</div>
        <div className="topbar-subtitle">{subtitle}</div>
      </div>
      {actions && <div className="topbar-actions">{actions}</div>}
    </div>
  );
}
