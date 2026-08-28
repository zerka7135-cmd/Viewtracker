import { useState } from 'react';
import { login, setupPassword } from '../api.js';
import { IconLogo, IconEye, IconEyeOff, IconCheck } from './icons.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LAST_EMAIL_KEY = 'vt-last-email';
// Doit correspondre à la durée totale de .login-split-card.is-success
// (délai + animation, voir theme.css#loginCardOut) — le temps de laisser
// voir le check avant de démonter l'écran et de passer au dashboard.
const SUCCESS_EXIT_MS = 750;

// Écran de connexion à deux panneaux (identité ViewTracker : bleu
// --accent, IconLogo, formes discrètes) — même composition qu'une
// maquette de référence (bandeau de bienvenue à gauche, formulaire à
// droite), adaptée à notre palette plutôt que reprise telle quelle.
// `setupMode` : premier accès, aucun compte encore créé (voir
// auth.js#isPasswordSet) — même écran, juste le texte/l'appel API qui
// changent (setupPassword plutôt que login), pas de champ "mot de passe
// actuel" puisqu'il n'y en a pas encore.
export default function LoginScreen({ setupMode, onSuccess }) {
  // Dernier e-mail utilisé sur cet appareil, pré-rempli mais éditable —
  // pas une vraie session, juste un confort pour ne pas le retaper à
  // chaque connexion (plusieurs comptes peuvent se connecter au même
  // dashboard, voir auth.js).
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem(LAST_EMAIL_KEY) || ''; } catch { return ''; }
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const emailValid = EMAIL_RE.test(email.trim());
  const emailTouched = email.length > 0;
  const confirmMismatch = setupMode && confirm.length > 0 && password !== confirm;

  const trackCapsLock = (e) => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('Adresse e-mail invalide');
      return;
    }
    if (setupMode && password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas');
      return;
    }
    setSubmitting(true);
    try {
      if (setupMode) await setupPassword(trimmedEmail, password);
      else await login(trimmedEmail, password);
      try { localStorage.setItem(LAST_EMAIL_KEY, trimmedEmail); } catch { /* non bloquant */ }
      // Laisse voir le check + la carte s'effacer (voir theme.css) avant
      // de prévenir App.jsx — sinon le dashboard remplacerait cet écran
      // d'un coup, sans transition, pile au moment où la requête réussit.
      setSubmitting(false);
      setSuccess(true);
      setTimeout(onSuccess, SUCCESS_EXIT_MS);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <div className={`login-split-card ${success ? 'is-success' : ''}`}>
        <div className="login-panel-brand">
          <DecorativeShapes />
          <div className="login-panel-brand-mark"><IconLogo style={{ width: '56%', height: '56%' }} /></div>
          <div className="login-panel-brand-title">
            {setupMode ? 'Bienvenue sur ViewTracker' : 'Content de te revoir'}
          </div>
          <div className="login-panel-brand-sub">
            {setupMode
              ? 'Crée le premier compte pour protéger l\'accès au dashboard — il pilote maintenant IG/TikTok/YouTube et les identifiants du bot.'
              : 'Connecte-toi pour accéder au classement, aux comptes suivis et aux réglages du bot.'}
          </div>
        </div>

        <form className="login-panel-form" onSubmit={submit} autoComplete="on">
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
            {setupMode ? 'Créer un compte' : 'Connexion'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 18 }}>
            {setupMode ? 'À retenir, il n\'y a pas de récupération par e-mail.' : 'E-mail et mot de passe du dashboard.'}
          </div>

          <label className="login-field-label" htmlFor="login-email">E-mail</label>
          <input
            id="login-email"
            className="input"
            type="email"
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="toi@exemple.com"
            style={{ marginBottom: 4, borderColor: emailTouched && !emailValid ? 'var(--red)' : undefined }}
          />
          <div style={{ minHeight: 4, marginBottom: emailTouched && !emailValid ? 8 : 14 }}>
            {emailTouched && !emailValid && <div className="login-strength-hint">✕ Adresse e-mail invalide</div>}
          </div>

          <label className="login-field-label" htmlFor="login-password">Mot de passe</label>
          <div className="login-input-wrap" style={{ marginBottom: setupMode ? 6 : 4 }}>
            <input
              id="login-password"
              className="input"
              type={reveal ? 'text' : 'password'}
              autoComplete={setupMode ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={trackCapsLock}
              onKeyDown={trackCapsLock}
              placeholder="••••••••"
            />
            <button
              type="button"
              className="login-reveal-btn"
              onClick={() => setReveal((v) => !v)}
              tabIndex={-1}
              aria-label={reveal ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            >
              {reveal ? <IconEyeOff size={16} key="off" /> : <IconEye size={16} key="on" />}
            </button>
          </div>

          {setupMode && (
            <div className={`login-strength-hint ${password.length >= 8 ? 'is-ok' : ''}`} style={{ marginBottom: 12 }}>
              {password.length >= 8 ? '✓' : '○'} Au moins 8 caractères ({password.length}/8)
            </div>
          )}
          {!setupMode && <div style={{ marginBottom: 18 }} />}

          {setupMode && (
            <>
              <label className="login-field-label" htmlFor="login-confirm">Confirmer le mot de passe</label>
              <input
                id="login-confirm"
                className="input"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                style={{ marginBottom: 6, borderColor: confirmMismatch ? 'var(--red)' : undefined }}
              />
              <div style={{ minHeight: 18, marginBottom: 12 }}>
                {confirmMismatch && <div className="login-strength-hint">✕ Les mots de passe ne correspondent pas</div>}
              </div>
            </>
          )}

          {capsLock && <div className="login-caps-hint">⚠ Verr. Maj activé</div>}
          {error && (
            <div className="login-error">
              <span aria-hidden="true">⚠</span> {error}
            </div>
          )}

          <button
            type="submit"
            className={`btn btn-accent ${success ? 'login-success-btn' : ''}`}
            disabled={submitting || success || !emailValid || !password || (setupMode && (password.length < 8 || confirmMismatch))}
            style={{ width: '100%', justifyContent: 'center', padding: '11px 0', gap: 8 }}
          >
            {success ? (
              <IconCheck className="login-check" size={18} />
            ) : (
              <>
                {submitting && <span className="login-spinner" aria-hidden="true" />}
                {submitting ? 'Un instant…' : setupMode ? 'Créer et se connecter' : 'Se connecter'}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// Cercles/traits/plus dispersés, dans le seul --accent (pas de dégradé
// arc-en-ciel) — décor discret, jamais plus voyant que le contenu.
function DecorativeShapes() {
  return (
    <svg className="login-panel-shapes" viewBox="0 0 400 460" fill="none" preserveAspectRatio="xMidYMid slice">
      <circle cx="40" cy="60" r="16" stroke="white" strokeOpacity="0.25" strokeWidth="2" />
      <circle cx="360" cy="380" r="10" stroke="white" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M20 220 Q 60 180 40 140 Q 20 100 60 60" stroke="white" strokeOpacity="0.15" strokeWidth="2" fill="none" />
      <path d="M340 40 Q 380 90 350 140 Q 320 190 370 230" stroke="white" strokeOpacity="0.15" strokeWidth="2" fill="none" />
      <g stroke="white" strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round">
        <line x1="300" y1="90" x2="300" y2="106" />
        <line x1="292" y1="98" x2="308" y2="98" />
      </g>
      <g stroke="white" strokeOpacity="0.2" strokeWidth="2" strokeLinecap="round">
        <line x1="70" y1="400" x2="70" y2="414" />
        <line x1="63" y1="407" x2="77" y2="407" />
      </g>
    </svg>
  );
}
