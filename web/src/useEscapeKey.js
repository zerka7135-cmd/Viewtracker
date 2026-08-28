import { useEffect } from 'react';

// Ferme une modale/un tiroir sur Échap — utilisé par AccountDrawer,
// AddAccountModal, ConfirmModal (voir web/src/components/). Sans ça, un
// clavier seul n'a aucun moyen de fermer ces overlays (le clic sur le
// backdrop est le seul chemin de sortie côté souris). `enabled` : certains
// de ces composants restent montés en permanence même overlay fermé (voir
// AccountDrawer, toujours rendu par App.jsx, account juste à null) — pas
// d'écouteur actif dans ce cas.
export function useEscapeKey(onEscape, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e) => {
      if (e.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEscape, enabled]);
}
