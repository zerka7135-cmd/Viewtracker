const VIEW_META = {
  dashboard: ['Dashboard', 'Classement, tendance et répartition des vues — Instagram, TikTok, YouTube'],
  accounts: ['Comptes suivis', 'Comptes configurés pour le suivi'],
  settings: ['Paramètres', 'Notifications, diffusion, compte et organisation']
};

// Pas de déclenchement de scan depuis le dashboard : la collecte reste
// pilotée uniquement par le cron planifié (voir src/index.js).
//
// `actions` : contenu optionnel affiché à droite, sur la même ligne que le
// titre (ex. la bascule Vues/Clics du Dashboard, voir ModeToggle.jsx/
// App.jsx) — vide sur les autres pages.
export default function TopBar({ view, actions }) {
  const [title, subtitle] = VIEW_META[view];

  return (
    <div className="topbar">
      <div>
        <div className="topbar-title">{title}</div>
        <div className="topbar-subtitle">{subtitle}</div>
      </div>
      {actions}
    </div>
  );
}
