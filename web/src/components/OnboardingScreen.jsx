import { useState } from 'react';
import { addAccount } from '../api.js';
import { IconLogo, IconPlus } from './icons.jsx';

// Étape obligatoire après l'inscription (voir signupUser côté serveur) :
// au moins un compte à suivre avant d'accéder au dashboard. Pas de choix
// de "mode scraping/API" — le bot reste scraping-only pour l'instant.
export default function OnboardingScreen({ onDone }) {
  const [name, setName] = useState('');
  const [igUrl, setIgUrl] = useState('');
  const [ttUrl, setTtUrl] = useState('');
  const [ytUrl, setYtUrl] = useState('');
  const [added, setAdded] = useState([]);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');

  const resetForm = () => { setName(''); setIgUrl(''); setTtUrl(''); setYtUrl(''); };

  const addOne = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError('');
    try {
      await addAccount(trimmed, [igUrl.trim(), ttUrl.trim(), ytUrl.trim()]);
      setAdded((list) => [...list, trimmed]);
      resetForm();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    setFinishing(true);
    try {
      await onDone();
    } catch (err) {
      setError(err.message);
      setFinishing(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="card" style={{ width: 460, maxWidth: '100%', padding: '26px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div className="sidebar-brand-mark"><IconLogo style={{ width: "60%", height: "60%" }} /></div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Bienvenue sur ViewTracker</div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Ajoute au moins un compte de clippeur à suivre (Instagram, TikTok et/ou YouTube) pour démarrer.
          </div>
        </div>

        {added.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {added.map((n, i) => (
              <div key={`${n}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card-alt)', borderRadius: 8, padding: '7px 10px', fontSize: 13 }}>
                <span style={{ color: 'var(--green)' }}>✓</span> {n}
              </div>
            ))}
          </div>
        )}

        <form onSubmit={addOne} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" placeholder="Nom du compte (ex: mon_compte)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="URL Instagram (optionnel)" value={igUrl} onChange={(e) => setIgUrl(e.target.value)} />
          <input className="input" placeholder="URL TikTok (optionnel)" value={ttUrl} onChange={(e) => setTtUrl(e.target.value)} />
          <input className="input" placeholder="URL YouTube (optionnel)" value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} />
          <button type="submit" className="btn btn-ghost" disabled={saving || !name.trim()} style={{ borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {saving ? 'Ajout…' : <><IconPlus size={14} /> Ajouter à la liste</>}
          </button>
        </form>

        {error && <div className="login-error">{error}</div>}

        <button
          className="btn btn-accent"
          disabled={added.length === 0 || finishing}
          onClick={finish}
          style={{ width: '100%', justifyContent: 'center', borderRadius: 8, padding: '10px 12px' }}
        >
          {finishing ? 'Finalisation…' : added.length === 0 ? 'Ajoute au moins un compte pour continuer' : `Terminer (${added.length} compte${added.length > 1 ? 's' : ''} ajouté${added.length > 1 ? 's' : ''})`}
        </button>
      </div>
    </div>
  );
}
