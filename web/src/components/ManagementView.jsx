import { useEffect, useState } from 'react';
import { getUsers, addUser, removeUser, updateUserAccess, setAccountRate, getSyncStatus, runSync } from '../api.js';
import ConfirmModal from './ConfirmModal.jsx';
import { IconTrash } from './icons.jsx';

// Gestion (admin) : membres et rôles, tarif par clic de chaque clipper, et
// synchronisation Supabase — l'équivalent de la page « Gestion » de l'app de
// référence. Chaque action est de nouveau contrôlée côté serveur (admin
// seulement, voir src/server.js#adminOnly).

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', clipper: 'Clipper' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
      {label}
      {children}
    </label>
  );
}

export default function ManagementView({ accounts, defaultRatePer1000, currentEmail, onAccountsChanged, onToast }) {
  const [users, setUsers] = useState(null);
  const [sync, setSync] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [form, setForm] = useState({ role: 'clipper', email: '', password: '', account: '', ratePer1000: '' });
  const [adding, setAdding] = useState(false);

  const refreshUsers = () => getUsers().then((res) => setUsers(res.users)).catch(() => {});
  const refreshSync = () => getSyncStatus().then(setSync).catch(() => {});
  useEffect(() => { refreshUsers(); refreshSync(); }, []);

  const accountNames = accounts.map((a) => a.name);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(form.email.trim())) return onToast('Erreur : adresse e-mail invalide');
    if (form.role === 'clipper' && !form.account) return onToast('Erreur : choisis le compte suivi de ce clipper');
    setAdding(true);
    try {
      await addUser(form.email.trim().toLowerCase(), form.password, form.role, form.role === 'clipper' ? form.account : null);
      if (form.role === 'clipper' && form.ratePer1000 !== '') {
        const res = await setAccountRate(form.account, Number(form.ratePer1000));
        onAccountsChanged(res.accounts);
      }
      onToast(`Compte "${form.email.trim()}" créé (${ROLE_LABELS[form.role]})`);
      setForm({ ...form, email: '', password: '', ratePer1000: '' });
      refreshUsers();
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    } finally {
      setAdding(false);
    }
  };

  const changeAccess = async (user, role, account) => {
    try {
      const res = await updateUserAccess(user.email, role, role === 'clipper' ? (account || accountNames[0]) : null);
      setUsers(res.users);
      onToast('Enregistré');
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
      refreshUsers();
    }
  };

  const saveRate = async (name, value, current) => {
    const next = value === '' ? null : Number(value);
    if ((next === null && current === null) || (next !== null && current !== null && Math.abs(next / 1000 - current) < 1e-9)) return;
    try {
      const res = await setAccountRate(name, next);
      onAccountsChanged(res.accounts);
      onToast('Enregistré');
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    }
  };

  const doSync = async (days) => {
    setSyncing(true);
    try {
      const res = await runSync(days);
      onToast(res.message);
    } catch (err) {
      onToast(`Échec : ${err.message}`);
    } finally {
      setSyncing(false);
      refreshSync();
    }
  };

  const confirmRemove = async () => {
    try {
      const res = await removeUser(removing.email);
      setUsers(res.users);
      onToast(`Compte "${removing.email}" supprimé`);
      setRemoving(null);
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    }
  };

  const last = sync?.last;
  const linkedUsers = (name) => (users ?? []).filter((u) => u.role === 'clipper' && u.account === name).map((u) => u.email);
  const selectStyle = { minWidth: 0 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="card" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {!sync ? 'Chargement…' : !sync.configured
            ? 'Supabase n’est pas configuré : ajoute SUPABASE_URL et SUPABASE_KEY dans les variables du serveur.'
            : last
              ? <>Dernière synchro : {new Date(last.ranAt).toLocaleString('fr-FR')} {last.ok ? '✓' : `— ${last.message}`}
                {last.ok && last.unmatched?.length > 0 && <div style={{ color: 'var(--orange)' }}>Non reliés à un compte suivi : {last.unmatched.join(', ')}</div>}</>
              : 'Jamais synchronisé'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" style={{ borderRadius: 980 }} disabled={syncing || !sync?.configured} onClick={() => doSync(365)}>Réimporter 12 mois</button>
          <button type="button" className="btn btn-accent" style={{ borderRadius: 980 }} disabled={syncing || !sync?.configured} onClick={() => doSync(7)}>
            {syncing ? 'Synchro…' : 'Actualiser depuis Supabase'}
          </button>
        </div>
      </div>

      <form className="card" onSubmit={submit} style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 14 }}>Ajouter un membre</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <Field label="Rôle">
            <select className="select" value={form.role} onChange={(e) => set({ role: e.target.value })}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="E-mail"><input className="input" type="email" required value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Mot de passe (8+)"><input className="input" required minLength={8} value={form.password} onChange={(e) => set({ password: e.target.value })} /></Field>
          {form.role === 'clipper' && (
            <>
              <Field label="Compte suivi (= nom du clipper)">
                <select className="select" required value={form.account} onChange={(e) => set({ account: e.target.value })}>
                  <option value="">Choisir…</option>
                  {accountNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
              <Field label={`€ pour 1 000 clics (défaut ${defaultRatePer1000})`}>
                <input className="input" type="number" step="0.01" min="0" value={form.ratePer1000} onChange={(e) => set({ ratePer1000: e.target.value })} />
              </Field>
            </>
          )}
        </div>
        <button type="submit" className="btn btn-accent" disabled={adding} style={{ marginTop: 16, borderRadius: 980 }}>{adding ? 'Création…' : 'Créer le compte'}</button>
      </form>

      <div className="card table-scroll" style={{ padding: 8 }}>
        <div style={{ padding: '10px 12px', fontWeight: 700 }}>Membres et rôles</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: 12 }}>E-mail</th><th style={{ padding: 12 }}>Rôle</th><th style={{ padding: 12 }}>Compte suivi</th><th style={{ padding: 12 }} />
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.email} style={{ borderBottom: '1px solid var(--table-row-border)' }}>
                <td style={{ padding: 12, fontWeight: 600 }}>{u.email}{u.email === currentEmail && <span style={{ color: 'var(--accent)', fontSize: 11 }}> (toi)</span>}</td>
                <td style={{ padding: 12 }}>
                  <select className="select" style={selectStyle} value={u.role} disabled={u.email === currentEmail} onChange={(e) => changeAccess(u, e.target.value, u.account)}>
                    {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </td>
                <td style={{ padding: 12 }}>
                  {u.role === 'clipper' ? (
                    <select className="select" style={selectStyle} value={u.account || ''} onChange={(e) => changeAccess(u, 'clipper', e.target.value)}>
                      {accountNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={{ padding: 12, textAlign: 'right' }}>
                  <button type="button" className="icon-btn icon-btn-danger" title="Supprimer ce compte" aria-label={`Supprimer ${u.email}`} disabled={u.email === currentEmail} onClick={() => setRemoving(u)}>
                    <IconTrash size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card table-scroll" style={{ padding: 8 }}>
        <div style={{ padding: '10px 12px', fontWeight: 700 }}>Clippers et tarifs</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: 12 }}>Compte suivi</th><th style={{ padding: 12 }}>Connexion</th><th style={{ padding: 12 }}>€ / 1 000 clics</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.name} style={{ borderBottom: '1px solid var(--table-row-border)' }}>
                <td style={{ padding: 12, fontWeight: 600 }}>{a.name}</td>
                <td style={{ padding: 12, color: 'var(--text-muted)' }}>{linkedUsers(a.name).join(', ') || '—'}</td>
                <td style={{ padding: 12 }}>
                  <input
                    className="input"
                    style={{ width: 120 }}
                    type="number" step="0.01" min="0"
                    placeholder={String(defaultRatePer1000)}
                    defaultValue={a.rateClick === null ? '' : +(a.rateClick * 1000).toFixed(4)}
                    key={`${a.name}-${a.rateClick}`}
                    onBlur={(e) => saveRate(a.name, e.target.value, a.rateClick)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
          Un champ vide utilise le tarif par défaut ({defaultRatePer1000} € pour 1 000 clics), réglable dans Paramètres &gt; Collecte.
        </div>
      </div>

      {removing && (
        <ConfirmModal
          title="Supprimer ce compte ?"
          message={`${removing.email} ne pourra plus se connecter au dashboard.`}
          confirmLabel="Supprimer"
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
