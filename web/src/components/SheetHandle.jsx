// Poignée de balayage des feuilles plein écran mobiles (voir
// useSwipeToClose.js) — élément dédié plutôt qu'un ::before CSS décoratif :
// c'est lui qui porte les gestionnaires de pointeur, précisément délimité à
// sa propre zone tactile (pas tout le haut de la feuille au pixel près),
// et `touch-action: none` (voir theme.css) l'empêche d'être intercepté par
// le scroll natif du navigateur pendant le glissement. Masqué sur desktop
// comme le reste de la feuille (voir .sheet-handle dans theme.css).
export default function SheetHandle(props) {
  return <div className="sheet-handle" aria-hidden="true" {...props} />;
}
