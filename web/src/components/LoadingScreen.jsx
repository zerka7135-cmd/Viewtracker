import { IconLogo } from './icons.jsx';

// Anneau qui tourne autour d'un avatar rond qui pulse — importé depuis
// Claude Design (Loader.dc.html, projet "Animation de loader circulaire").
// Le logo robot (même IconLogo que la sidebar/écrans de connexion) est
// affiché directement sur un disque var(--accent) plutôt que la photo
// d'origine du design : le bleu de la photo ne correspondait pas
// exactement à var(--accent), ce qui créait une bordure visible entre le
// disque et l'image au lieu d'un aplat uni.
export default function LoadingScreen() {
  return (
    <div className="login-screen">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
        <div style={{ position: 'relative', width: 120, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="120" height="120" viewBox="0 0 120 120" style={{ position: 'absolute', inset: 0, animation: 'loaderSpin 1.1s linear infinite' }}>
            <circle cx="60" cy="60" r="53" fill="none" stroke="var(--border-strong)" strokeWidth="6" />
            <circle cx="60" cy="60" r="53" fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeDasharray="80 260" />
          </svg>
          <div
            style={{
              width: 86, height: 86, borderRadius: '50%',
              background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(10, 132, 255, 0.35)',
              animation: 'loaderPulse 1.4s ease-in-out infinite'
            }}
          >
            <IconLogo style={{ width: '56%', height: '56%' }} />
          </div>
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-muted)' }}>ViewTracker</div>
      </div>

      <style>{`
        @keyframes loaderSpin { to { transform: rotate(360deg); } }
        @keyframes loaderPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      `}</style>
    </div>
  );
}
