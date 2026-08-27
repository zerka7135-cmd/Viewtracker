import { useState } from 'react';
import { login, setupPassword } from '../api.js';
import { IconLogo } from './icons.jsx';

// Écran de connexion à deux panneaux (identité ViewTracker : bleu
// --accent, IconLogo, formes discrètes) — même composition qu'une
// maquette de référence (bandeau de bienvenue à gauche, formulaire à
// droite), adaptée à notre palette plutôt que reprise telle quelle.
// `setupMode` : premier accès, aucun mot de passe encore configuré (voir
// auth.js#isPasswordSet) — même écran, juste le texte/l'appel API qui
// changent (setupPassword plutôt que login), pas de champ "mot de passe
// actuel" puisqu'il n'y en a pas encore.
export default function LoginScreen({ setupMode, onSuccess }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (setupMode && password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas');
      return;
    }
    setSubmitting(true);
    try {
      if (setupMode) await setupPassword(password);
      else await login(password);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-split-card">
        <div className="login-panel-brand">
          <DecorativeShapes />
          <div className="login-panel-brand-mark"><IconLogo style={{ width: '56%', height: '56%' }} /></div>
          <div className="login-panel-brand-title">
            {setupMode ? 'Bienvenue sur ViewTracker' : 'Content de te revoir'}
          </div>
          <div className="login-panel-brand-sub">
            {setupMode
              ? 'Choisis un mot de passe pour protéger l\'accès au dashboard — il pilote maintenant IG/TikTok/YouTube et les identifiants du bot.'
              : 'Connecte-toi pour accéder au classement, aux comptes suivis et aux réglages du bot.'}
          </div>
        </div>

        <form className="login-panel-form" onSubmit={submit}>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
            {setupMode ? 'Créer un mot de passe' : 'Connexion'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 18 }}>
            {setupMode ? 'Au moins 8 caractères — à retenir, il n\'y a pas d\'autre compte.' : 'Mot de passe du dashboard.'}
          </div>

          <label className="login-field-label">Mot de passe</label>
          <input
            className="input"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{ marginBottom: setupMode ? 12 : 18 }}
          />

          {setupMode && (
            <>
              <label className="login-field-label">Confirmer le mot de passe</label>
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                style={{ marginBottom: 18 }}
              />
            </>
          )}

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn btn-accent" disabled={submitting || !password} style={{ width: '100%', justifyContent: 'center', padding: '11px 0' }}>
            {submitting ? 'Un instant…' : setupMode ? 'Créer et se connecter' : 'Se connecter'}
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
