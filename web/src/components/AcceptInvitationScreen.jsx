import { useState } from 'react';
import { IconLogo } from './icons.jsx';
import { acceptInvitation } from '../api.js';
import PasswordInput from './PasswordInput.jsx';

// Affiché quand l'URL contient ?inviteId=... (lien reçu par email, voir
// auth.js#inviteMember) — même famille que ResetPasswordScreen.jsx.
export default function AcceptInvitationScreen({ inviteId, onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await acceptInvitation(inviteId, password);
      onDone();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="card login-card" onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="sidebar-brand-mark"><IconLogo style={{ width: "60%", height: "60%" }} /></div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Rejoindre l'organisation</div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Choisis un mot de passe pour créer ton compte et rejoindre l'organisation qui t'a invité.
        </div>
        <PasswordInput
          placeholder="Mot de passe"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: '10px 12px', fontSize: 13.5 }}
        />
        {error && <div className="login-error">{error}</div>}
        <button
          className="btn btn-accent"
          type="submit"
          disabled={loading || !password}
          style={{ width: '100%', justifyContent: 'center', borderRadius: 8, padding: '10px 12px' }}
        >
          {loading ? 'Création…' : "Rejoindre l'organisation"}
        </button>
      </form>
    </div>
  );
}
