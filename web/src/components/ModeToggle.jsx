import SegmentedControl from './SegmentedControl.jsx';

// Bascule Vues/Clics/Tous du Dashboard — deux façons de lire le même
// classement de comptes (performance de contenu vs conversion des liens
// en bio, voir bioLink.js), plus "Tous" qui empile les deux sections.
// L'état `mode` est géré par App.jsx, partagé avec DashboardView.jsx.
const OPTIONS = [['views', 'Vues'], ['clicks', 'Clics'], ['all', 'Tous']];

export default function ModeToggle({ mode, onChange }) {
  return <SegmentedControl options={OPTIONS} value={mode} onChange={onChange} style={{ width: 220 }} />;
}
