// Icônes SVG minimalistes (style trait, cohérent avec le design Apple-like
// de l'app) — pas de dépendance externe (lucide/heroicons), juste de petits
// composants inline pour rester "self-contained". `size` accepte n'importe
// quelle valeur CSS (px, em…), la couleur suit `currentColor` (donc `color`
// du parent).
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

// aria-hidden par défaut : ces icônes sont toujours à côté d'un texte ou
// dans un bouton déjà nommé (aria-label/texte visible) — sans ça, chaque
// <svg> serait exposé comme contenu graphique sans nom aux lecteurs
// d'écran, du bruit plutôt que de l'info. Surchargeable via `aria-hidden`
// dans les rares cas où l'icône porte l'information à elle seule.
function Svg({ size = 18, children, ...rest }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export function IconDashboard(props) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
    </Svg>
  );
}

export function IconAccounts(props) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <circle cx="17" cy="7.5" r="2.3" />
      <path d="M14.8 14.8c2.5.2 4.7 2.2 4.7 5.2" />
    </Svg>
  );
}

export function IconHistory(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </Svg>
  );
}

export function IconSettings(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6M17.8 17.8l-1.6-1.6M7.8 7.8L6.2 6.2" />
    </Svg>
  );
}

export function IconChevronLeft(props) {
  return (
    <Svg {...props}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </Svg>
  );
}

export function IconChevronRight(props) {
  return (
    <Svg {...props}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </Svg>
  );
}

export function IconLogout(props) {
  return (
    <Svg {...props}>
      <path d="M9 4H6a1.6 1.6 0 0 0-1.6 1.6v12.8A1.6 1.6 0 0 0 6 20h3" />
      <path d="M14 8l4 4-4 4" />
      <path d="M18 12H9.5" />
    </Svg>
  );
}

export function IconCheck(props) {
  return (
    <Svg {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Svg>
  );
}

export function IconEye(props) {
  return (
    <Svg {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function IconEyeOff(props) {
  return (
    <Svg {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.6A10.6 10.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15.4 15.4 0 0 1-3.2 4" />
      <path d="M6.6 6.6C4 8.4 2.5 12 2.5 12S6 18.5 12 18.5a9.9 9.9 0 0 0 4-.8" />
      <path d="M9.9 10a3 3 0 0 0 4.1 4.1" />
    </Svg>
  );
}

export function IconEdit(props) {
  return (
    <Svg {...props}>
      <path d="M4 20l.9-3.6L15.4 6a1.9 1.9 0 0 1 2.7 0 1.9 1.9 0 0 1 0 2.7L7.6 19.1 4 20Z" />
    </Svg>
  );
}

export function IconTrash(props) {
  return (
    <Svg {...props}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2" />
      <path d="M6.5 7l.8 12.2A1.5 1.5 0 0 0 8.8 20.5h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

export function IconPlus(props) {
  return (
    <Svg {...props}>
      <path d="M12 4.5v15M4.5 12h15" />
    </Svg>
  );
}

export function IconDownload(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.5v12M7 11l5 5 5-5" />
      <path d="M4.5 19.5h15" />
    </Svg>
  );
}

export function IconCompare(props) {
  return (
    <Svg {...props}>
      <path d="M4 16 9 9l4 4 7-8" />
      <path d="M4 20h16" />
    </Svg>
  );
}

export function IconSearch(props) {
  return (
    <Svg {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M19.5 19.5 15 15" />
    </Svg>
  );
}

export function IconCopy(props) {
  return (
    <Svg {...props}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6.5A2 2 0 0 0 13.5 4.5h-8A2 2 0 0 0 3.5 6.5v8a2 2 0 0 0 2 2h2" />
    </Svg>
  );
}

// Logo de l'app (marque "sidebar-brand-mark") — un petit robot, toujours
// affiché sur le carré bleu var(--accent-fill) (sidebar, écrans de connexion,
// écran de chargement) : les yeux sont donc remplis de la même couleur
// que ce fond plutôt que de currentColor, pour créer l'effet "découpe".
export function IconLogo(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="3.4" r="1.3" fill="var(--on-accent)" />
      <rect x="11.3" y="4.5" width="1.4" height="2.4" rx="0.7" fill="var(--on-accent)" />
      <rect x="2.7" y="10" width="2.6" height="6" rx="1.3" fill="var(--on-accent)" />
      <rect x="18.7" y="10" width="2.6" height="6" rx="1.3" fill="var(--on-accent)" />
      <rect x="5" y="7.3" width="14" height="11.7" rx="5.2" fill="var(--on-accent)" />
      <rect x="8.9" y="11.8" width="2.2" height="3.2" rx="1.1" fill="var(--accent-fill)" />
      <rect x="12.9" y="11.8" width="2.2" height="3.2" rx="1.1" fill="var(--accent-fill)" />
    </svg>
  );
}

export function IconClick(props) {
  return (
    <Svg {...props}>
      <path d="M6 4v3M4 9H1M8.2 6.2 6.1 8.3" />
      <path d="M9.5 10.5 20 13.8l-4.3 1.9-1.9 4.3z" />
    </Svg>
  );
}

export function IconTrophy(props) {
  return (
    <Svg {...props}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
      <path d="M8 6H5a2 2 0 0 0 2 4.5M16 6h3a2 2 0 0 1-2 4.5" />
      <path d="M12 13v4M8.5 20h7M9.5 17h5" />
    </Svg>
  );
}

export function IconCalendar(props) {
  return (
    <Svg {...props}>
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </Svg>
  );
}

export function IconUsers(props) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.6-3 2.9-4.7 5.5-4.7s4.9 1.7 5.5 4.7" />
      <path d="M16 6a3 3 0 0 1 0 5.6M17.5 14.6c1.7.5 2.7 2 3 4.4" />
    </Svg>
  );
}
