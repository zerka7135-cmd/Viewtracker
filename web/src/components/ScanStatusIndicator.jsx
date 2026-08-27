import { fmtRelativeTimeWithClock } from '../format.js';

// Repère de fraîcheur des données — sans bouton de scan manuel dans le
// dashboard, c'est le seul moyen pour l'utilisateur de savoir si les
// chiffres affichés datent d'il y a 5 minutes ou de 3 jours. Affiché dans
// TopBar (voir App.jsx).
export default function ScanStatusIndicator({ scan }) {
  if (!scan) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: scan.lastScanError ? 'var(--orange)' : 'var(--text-muted)' }}>
      <div
        className={scan.scanning ? 'dot dot-pulse' : 'dot'}
        style={{ background: scan.scanning ? 'var(--accent)' : scan.lastScanError ? 'var(--orange)' : 'var(--green)' }}
      />
      {scan.scanning ? (
        'Collecte en cours…'
      ) : scan.lastScanAt ? (
        <>Dernière collecte {fmtRelativeTimeWithClock(scan.lastScanAt)}{scan.lastScanError && ' — terminée avec erreur'}</>
      ) : (
        'Aucune collecte enregistrée pour le moment'
      )}
    </div>
  );
}
