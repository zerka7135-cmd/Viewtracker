import { useState } from 'react';
import { addAccount as addAccountApi, updateAccount as updateAccountApi } from '../api.js';

// Sert à la fois pour ajouter un nouveau compte et pour éditer un compte
// existant (voir AccountsView.jsx) — passer `account` (avec ses `urls`,
// voir dashboardData.js) bascule en mode édition.
export default function AddAccountModal({ account, onClose, onAdded, onToast }) {
  const isEdit = !!account;
  const [name, setName] = useState(account?.name || '');
  const [igUrl, setIgUrl] = useState(account?.urls?.[0] || '');
  const [ttUrl, setTtUrl] = useState(account?.urls?.[1] || '');
  const [ytUrl, setYtUrl] = useState(account?.urls?.[2] || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = isEdit
        ? await updateAccountApi(account.name, trimmed, [igUrl.trim(), ttUrl.trim(), ytUrl.trim()])
        : await addAccountApi(trimmed, [igUrl.trim(), ttUrl.trim(), ytUrl.trim()]);
      onAdded(res.accounts);
      onToast(isEdit ? `Compte "${trimmed}" mis à jour` : `Compte "${trimmed}" ajouté — apparaîtra au prochain scan`);
      onClose();
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="modal">
        <form className="card modal-card" onSubmit={submit}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{isEdit ? 'Modifier le compte' : 'Ajouter un compte'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Renseigne au moins une plateforme — les autres restent optionnelles.
              </div>
            </div>
            <div onClick={onClose} style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, padding: 4 }}>×</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input className="input" autoFocus placeholder="Nom du compte (ex: mon_compte)" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="URL Instagram (optionnel)" value={igUrl} onChange={(e) => setIgUrl(e.target.value)} />
            <input className="input" placeholder="URL TikTok (optionnel)" value={ttUrl} onChange={(e) => setTtUrl(e.target.value)} />
            <input className="input" placeholder="URL YouTube (optionnel)" value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-accent" disabled={saving || !name.trim()}>
              {saving ? (isEdit ? 'Enregistrement…' : 'Ajout…') : (isEdit ? 'Enregistrer' : 'Ajouter')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
