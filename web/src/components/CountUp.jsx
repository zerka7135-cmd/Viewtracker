import { useEffect, useRef, useState } from 'react';
import { fmt } from '../format.js';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Valeur numérique qui s'anime de sa valeur précédente vers la nouvelle
 * (0 au tout premier rendu) — utilisé pour les KPI en haut du dashboard,
 * pour donner un repère visuel qu'un chiffre vient de changer plutôt que
 * de le faire apparaître d'un coup. Respecte prefers-reduced-motion (saute
 * directement à la valeur finale).
 */
export default function CountUp({ value, duration = 700 }) {
  const [display, setDisplay] = useState(prefersReducedMotion() ? value : 0);
  const fromRef = useRef(display);
  const rafRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }

    const from = fromRef.current;
    const to = value;
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return fmt(display);
}
