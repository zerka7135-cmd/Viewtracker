import { useState } from 'react';
import { fmt } from '../format.js';
import { useAccountFilters } from '../useAccountFilters.js';
import { deleteAccount as deleteAccountApi } from '../api.js';
import AddAccountModal from './AddAccountModal.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import { IconEdit, IconTrash, IconPlus, IconSearch } from './icons.jsx';

export default function AccountsView({ accounts, onOpenDrawer, onAccountsChanged, onToast }) {
  const f = useAccountFilters(accounts);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [deletingAccount, setDeletingAccount] = useState(null);

  const activeFilterCount = (f.status !== 'all' ? 1 : 0) + (f.platform !== 'all' ? 1 : 0) + (f.search.length > 0 ? 1 : 0);

  const confirmDelete = async () => {
    try {
      const res = await deleteAccountApi(deletingAccount.name);
      onAccountsChanged(res.accounts);
      onToast(`Compte "${deletingAccount.name}" supprimé`);
      setDeletingAccount(null);
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="filters-row">
          <div className="search-input-wrap" style={{ flex: 1, minWidth: 180, maxWidth: 320 }}>
            <IconSearch size={14} />
            <input
              className="input"
              style={{ padding: '10px 14px 10px 30px', fontSize: 13 }}
              placeholder="Rechercher un compte…"
              value={f.search}
              onChange={(e) => f.setSearch(e.target.value)}
            />
          </div>
          <select className="select" style={{ padding: '9px 12px', fontSize: 13 }} value={f.sort} onChange={(e) => f.setSort(e.target.value)}>
            <option value="total">Trier : total</option>
            <option value="nom">Trier : nom</option>
            <option value="croissance">Trier : croissance</option>
          </select>
          <button className="btn btn-accent" style={{ marginLeft: 'auto' }} onClick={() => setShowAddModal(true)}>
            <IconPlus size={14} /> Ajouter un compte
          </button>
        </div>
        <div className="filters-row">
          <select className="select" value={f.status} onChange={(e) => f.setStatus(e.target.value)}>
            <option value="all">Statut : tous</option>
            <option value="active">Actifs</option>
            <option value="warning">Placeholders</option>
          </select>
          <select className="select" value={f.platform} onChange={(e) => f.setPlatform(e.target.value)}>
            <option value="all">Plateforme : toutes</option>
            <option value="ig">Instagram</option>
            <option value="tt">TikTok</option>
            <option value="yt">YouTube</option>
          </select>
          {activeFilterCount > 0 && (
            <div style={{ background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 980 }}>
              {activeFilterCount} filtre(s)
            </div>
          )}
          {f.active && <button className="btn-link" onClick={f.reset}>Réinitialiser</button>}
          <div className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            {f.filtered.length} compte(s)
          </div>
        </div>
      </div>

      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onAdded={onAccountsChanged}
          onToast={onToast}
        />
      )}
      {editingAccount && (
        <AddAccountModal
          account={editingAccount}
          onClose={() => setEditingAccount(null)}
          onAdded={onAccountsChanged}
          onToast={onToast}
        />
      )}
      {deletingAccount && (
        <ConfirmModal
          title="Supprimer le compte"
          message={<>Supprimer <strong>{deletingAccount.name}</strong> ? Son historique de vues sera perdu.</>}
          confirmLabel="Supprimer"
          onConfirm={confirmDelete}
          onCancel={() => setDeletingAccount(null)}
        />
      )}

      <div className="card" style={{ padding: '8px 14px' }}>
        <div className="table-scroll">
          <div className="table-header" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 90px 64px' }}>
            <div>Compte</div><div>Instagram</div><div>TikTok</div><div>YouTube</div><div>Total</div><div>Statut</div><div></div>
          </div>
          {f.filtered.map((a) => (
            <div
              key={a.name}
              className="table-row"
              style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 90px 64px' }}
              onClick={() => onOpenDrawer(a.name)}
            >
              <div className="ellipsis table-cell-title" style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</div>
              <div className="mono ellipsis" data-label="Instagram" style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>{a.ig === null ? '—' : fmt(a.ig)}</div>
              <div className="mono ellipsis" data-label="TikTok" style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>{a.tt === null ? '—' : fmt(a.tt)}</div>
              <div className="mono ellipsis" data-label="YouTube" style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>{a.yt === null ? '—' : fmt(a.yt)}</div>
              <div className="mono ellipsis" data-label="Total" style={{ fontSize: 13.5, fontWeight: 700 }}>{fmt(a.total)}</div>
              <div data-label="Statut" style={{ fontSize: 11.5, fontWeight: 600, color: a.total === 0 ? 'var(--orange)' : 'var(--green)' }}>
                {a.total === 0 ? '⚠ Placeholder' : '✓ Actif'}
              </div>
              <div className="table-cell-actions" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="icon-btn"
                  title="Modifier"
                  onClick={(e) => { e.stopPropagation(); setEditingAccount(a); }}
                >
                  <IconEdit size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  title="Supprimer"
                  onClick={(e) => { e.stopPropagation(); setDeletingAccount(a); }}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            </div>
          ))}
          {f.filtered.length === 0 && (
            <div style={{ padding: '24px 8px', color: 'var(--text-muted)', fontSize: 13 }}>Aucun compte ne correspond à ces filtres.</div>
          )}
        </div>
      </div>
    </div>
  );
}
