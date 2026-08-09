import { useState } from 'react';
import { IconLogo } from './icons.jsx';
import { login, signup, forgotPassword } from '../api.js';
import PasswordInput from './PasswordInput.jsx';

export default function LoginScreen({ onSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({}); // { email?, password? } — champs vides à la soumission
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';

  const submit = async (e) => {
    e.preventDefault();

    const errors = {};
    if (!email.trim()) errors.email = 'Email requis';
    if (!isForgot && !password) errors.password = 'Mot de passe requis';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    setError('');
    try {
      if (isForgot) {
        await forgotPassword(email);
        setForgotSent(true);
      } else {
        const session = await (isSignup ? signup(email, password) : login(email, password));
        onSuccess(session);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setFieldErrors({});
    setForgotSent(false);
  };

  return (
    <div className="login-screen">
      <form className="card login-card" onSubmit={submit} noValidate>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="sidebar-brand-mark"><IconLogo style={{ width: "60%", height: "60%" }} /></div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>ViewTracker</div>
        </div>

        {isForgot && forgotSent ? (
          <div style={{ fontSize: 13, color: 'var(--text-faint)', lineHeight: 1.5 }}>
            Si un compte existe avec l'adresse <strong>{email}</strong>, un email avec un lien de
            réinitialisation vient d'être envoyé (valable 1 heure).
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                className="input"
                type="email"
                placeholder="Email"
                autoFocus
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined })); }}
                style={{ padding: '10px 12px', fontSize: 13.5 }}
              />
              {fieldErrors.email && <div className="login-error">{fieldErrors.email}</div>}
            </div>
            {!isForgot && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <PasswordInput
                  placeholder="Mot de passe"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined })); }}
                  style={{ padding: '10px 12px', fontSize: 13.5 }}
                />
                {fieldErrors.password && <div className="login-error">{fieldErrors.password}</div>}
                {!isSignup && (
                  <button type="button" className="btn-link" style={{ alignSelf: 'flex-end' }} onClick={() => switchMode('forgot')}>
                    Mot de passe oublié ?
                  </button>
                )}
              </div>
            )}
            {isSignup && (
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Crée une nouvelle organisation vide, dont tu seras propriétaire — pas d'accès aux données existantes.
              </div>
            )}
            {error && <div className="login-error">{error}</div>}
            <button
              className="btn btn-accent"
              type="submit"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', borderRadius: 8, padding: '10px 12px' }}
            >
              {loading
                ? (isForgot ? 'Envoi…' : isSignup ? 'Création…' : 'Connexion…')
                : (isForgot ? 'Envoyer le lien' : isSignup ? 'Créer un compte' : 'Se connecter')}
            </button>
          </>
        )}

        <button type="button" className="btn-link" style={{ textAlign: 'center' }} onClick={() => switchMode(isSignup || isForgot ? 'login' : 'signup')}>
          {isSignup ? 'Déjà un compte ? Se connecter' : isForgot ? 'Retour à la connexion' : 'Créer un compte ?'}
        </button>
      </form>
    </div>
  );
}
