import { useRef } from 'react';

// Poignée de balayage interactive pour les feuilles plein écran mobiles
// (AccountDrawer/AddAccountModal/ConfirmModal/AccountComparisonModal — voir
// leur ".drawer"/".modal-card" en feuille sous 700px, theme.css). La
// poignée était jusqu'ici purement décorative (::before en CSS) ; ce hook
// la rend vraiment glissable, comme une feuille native iOS/Android. Le
// geste ne démarre que depuis l'élément poignée lui-même (voir
// SheetHandle.jsx, rendu en premier enfant de la feuille) — jamais depuis
// le contenu ou les boutons du header juste en dessous, pour ne jamais
// intercepter un scroll ou un tap involontairement.
//
// `sheetRef` : à poser sur l'élément racine de la feuille (celui qui
// glisse). `handleProps` : à répandre sur <SheetHandle/>.
const DISMISS_DISTANCE = 110; // px glissés avant fermeture au relâchement
const DISMISS_VELOCITY = 0.5; // px/ms — fermeture aussi sur un flick rapide

export function useSwipeToClose(onClose) {
  const sheetRef = useRef(null);
  const state = useRef({ dragging: false, startY: 0, startT: 0, y: 0 });

  const setTransform = (y, withTransition) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = withTransition ? 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)' : 'none';
    el.style.transform = y > 0 ? `translateY(${y}px)` : '';
  };

  const onPointerDown = (e) => {
    // La feuille elle-même n'existe qu'en dessous de 700px (voir
    // theme.css) — inutile sur desktop, où cette poignée est masquée.
    if (window.innerWidth > 700) return;
    state.current = { dragging: true, startY: e.clientY, startT: Date.now(), y: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!state.current.dragging) return;
    const dy = Math.max(0, e.clientY - state.current.startY);
    state.current.y = dy;
    setTransform(dy, false);
  };

  const finish = () => {
    if (!state.current.dragging) return;
    const { y, startT } = state.current;
    const elapsed = Math.max(1, Date.now() - startT);
    const velocity = y / elapsed;
    state.current.dragging = false;
    if (y > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
      onClose();
      // Pas de retour à 0 après fermeture : le composant se démonte/masque
      // (voir AccountDrawer#closing) — un snap arrière serait visible
      // pendant l'animation de sortie, un signal contradictoire.
    } else {
      setTransform(0, true);
    }
  };

  return {
    sheetRef,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish
    }
  };
}
