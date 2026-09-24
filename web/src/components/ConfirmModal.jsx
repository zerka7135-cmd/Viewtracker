import { useState } from 'react';
import { useEscapeKey } from '../useEscapeKey.js';
import { useSwipeToClose } from '../useSwipeToClose.js';
import CloseButton from './CloseButton.jsx';
import SheetHandle from './SheetHandle.jsx';

// Modale de confirmation générique (suppression d'un compte suivi, pour
// l'instant) — remplace window.confirm(), qui n'est pas stylisé et
// détonne avec le reste du dashboard. Volontairement plus légère que la
// confirmation "retape le nom" utilisée pour supprimer une organisation
// (voir backup/dashboard-rewrite-27-08) : supprimer un compte suivi n'a
// pas la même gravité (recréable en un clic, pas de cascade sur des
// membres/mots de passe) — un bouton "Annuler"/"Supprimer" clair suffit.
export default function ConfirmModal({ title, message, confirmLabel = 'Confirmer', onConfirm, onCancel }) {
  const [pending, setPending] = useState(false);
  useEscapeKey(onCancel);
  const { sheetRef, handleProps } = useSwipeToClose(onCancel);

  const handleConfirm = async () => {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      // Si onConfirm a fermé la modale entre-temps (cas normal), ce setState
      // s'applique à un composant déjà démonté — React l'ignore silencieusement.
      setPending(false);
    }
  };

  return (
    <>
      <div className="backdrop" onClick={onCancel} />
      <div className="modal">
        <div className="card modal-card" style={{ border: '1px solid color-mix(in oklab, var(--red) 35%, transparent)' }} ref={sheetRef}>
          <SheetHandle {...handleProps} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)' }}>{title}</div>
            <CloseButton onClick={onCancel} />
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{message}</div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>Annuler</button>
            <button
              type="button"
              className="btn"
              onClick={handleConfirm}
              disabled={pending}
              style={{ borderRadius: 980, padding: '9px 18px', fontSize: 13, fontWeight: 600, color: 'var(--on-accent)', background: 'var(--red)' }}
            >
              {pending ? 'Suppression…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
