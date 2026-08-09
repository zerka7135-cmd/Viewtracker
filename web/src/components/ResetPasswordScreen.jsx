import { useState } from 'react';
import { IconLogo } from './icons.jsx';
import { resetPassword } from '../api.js';
import PasswordInput from './PasswordInput.jsx';

// Affiché quand l'URL contient ?resetToken=... (lien reçu par email, voir
// auth.js#requestPasswordReset) — indépendant de LoginScreen car atteint
// directement depuis un lien externe, pas via un clic dans l'app.
export default function ResetPasswordScreen({ token, onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="card login-card" onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="sidebar-brand-mark"><IconLogo style={{ width: "60%", height: "60%" }} /></div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Nouveau mot de passe</div>
        </div>

        {done ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-faint)', lineHeight: 1.5 }}>
              Mot de passe mis à jour. Tu peux te connecter avec le nouveau.
            </div>
            <button type="button" className="btn btn-accent" style={{ width: '100%', justifyContent: 'center', borderRadius: 8, padding: '10px 12px' }} onClick={onDone}>
              Aller à la connexion
            </button>
          </>
        ) : (
          <>
            <PasswordInput
              placeholder="Nouveau mot de passe"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ padding: '10px 12px', fontSize: 13.5 }}
            />
            <PasswordInput
              placeholder="Confirmer le mot de passe"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={{ padding: '10px 12px', fontSize: 13.5 }}
            />
            {error && <div className="login-error">{error}</div>}
            <button
              className="btn btn-accent"
              type="submit"
              disabled={loading || !password || !confirm}
              style={{ width: '100%', justifyContent: 'center', borderRadius: 8, padding: '10px 12px' }}
            >
              {loading ? 'Mise à jour…' : 'Changer le mot de passe'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
