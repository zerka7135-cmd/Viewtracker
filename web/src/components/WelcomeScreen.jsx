import { IconLogo } from './icons.jsx';

// Écran de bienvenue affiché une fois par onglet, avant l'écran de
// connexion (voir App.jsx) — pas un formulaire, juste une transition
// d'accueil qui pose l'identité ViewTracker avant de demander le mot de
// passe. `onContinue` déclenche la sortie (voir animation "welcome-exiting"
// côté App.jsx) puis le montage de LoginScreen, qui a sa propre animation
// d'entrée (voir theme.css#loginCardIn) : les deux s'enchaînent pour
// donner une transition continue plutôt qu'un jump cut.
export default function WelcomeScreen({ exiting, onContinue }) {
  return (
    <div className={`login-screen welcome-screen ${exiting ? 'is-exiting' : ''}`}>
      <WelcomeShapes />
      <div className="welcome-content">
        <div className="welcome-mark">
          <IconLogo style={{ width: '52%', height: '52%' }} />
        </div>
        <div className="welcome-title">ViewTracker</div>
        <div className="welcome-sub">
          Le classement Instagram, TikTok et YouTube de tes comptes suivis
          — vues, tendances et alertes, au même endroit que le bot Discord.
        </div>
        <button type="button" className="btn btn-accent welcome-cta" onClick={onContinue}>
          Commencer
          <span className="welcome-cta-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

// Mêmes formes que DecorativeShapes (LoginScreen.jsx), en plus dispersé
// puisqu'elles couvrent tout l'écran ici plutôt qu'un seul panneau — reste
// dans --accent, jamais un dégradé arc-en-ciel, toujours discret.
function WelcomeShapes() {
  return (
    <svg className="welcome-shapes" viewBox="0 0 1200 800" fill="none" preserveAspectRatio="xMidYMid slice">
      <circle cx="120" cy="140" r="30" stroke="var(--accent)" strokeOpacity="0.22" strokeWidth="2" />
      <circle cx="1080" cy="640" r="18" stroke="var(--accent)" strokeOpacity="0.2" strokeWidth="2" />
      <circle cx="1000" cy="120" r="10" stroke="var(--accent)" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M60 400 Q 140 320 100 240 Q 60 160 160 100" stroke="var(--accent)" strokeOpacity="0.14" strokeWidth="2" fill="none" />
      <path d="M1120 300 Q 1180 380 1120 460 Q 1060 540 1140 600" stroke="var(--accent)" strokeOpacity="0.14" strokeWidth="2" fill="none" />
      <g stroke="var(--accent)" strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round">
        <line x1="220" y1="620" x2="220" y2="640" />
        <line x1="210" y1="630" x2="230" y2="630" />
      </g>
      <g stroke="var(--accent)" strokeOpacity="0.22" strokeWidth="2" strokeLinecap="round">
        <line x1="950" y1="440" x2="950" y2="458" />
        <line x1="941" y1="449" x2="959" y2="449" />
      </g>
    </svg>
  );
}
