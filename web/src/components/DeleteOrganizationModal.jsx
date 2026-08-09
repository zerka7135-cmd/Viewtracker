import { useState } from 'react';
import { deleteOrganization } from '../api.js';

// Exige de retaper exactement le nom de l'organisation avant d'activer le
// bouton de suppression — action irréversible (comptes suivis, historique,
// cumul, membres... tout part en cascade, voir org.js#deleteOrganization).
export default function DeleteOrganizationModal({ orgName, onClose, onDeleted, onToast }) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const matches = confirmText === orgName;

  const submit = async (e) => {
    e.preventDefault();
    if (!matches) return;
    setDeleting(true);
    try {
      await deleteOrganization(orgName);
      onDeleted();
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="modal">
        <form className="card modal-card" onSubmit={submit} style={{ border: '1px solid rgba(255,69,58,0.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)' }}>Supprimer l'organisation</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                Action <strong>irréversible</strong> : tous les comptes suivis, l'historique, le
                cumul de vues et les membres de <strong>{orgName}</strong> seront définitivement supprimés.
              </div>
            </div>
            <div onClick={onClose} style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, padding: 4 }}>×</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              Tape <span className="mono" style={{ fontWeight: 700 }}>{orgName}</span> pour confirmer :
            </div>
            <input
              className="input"
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={orgName}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button
              type="submit"
              className="btn"
              disabled={!matches || deleting}
              style={{
                borderRadius: 980, padding: '9px 18px', fontSize: 13, fontWeight: 600, color: '#fff',
                background: matches ? 'var(--red)' : 'var(--card-alt)',
                opacity: matches ? 1 : 0.6
              }}
            >
              {deleting ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
