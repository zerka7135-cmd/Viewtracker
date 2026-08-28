// Bouton "×" de fermeture — répété à l'identique dans AccountDrawer,
// AddAccountModal et ConfirmModal avant cette extraction. `size` couvre
// les deux tailles utilisées (22px dans le tiroir, 20px dans les modales).
export default function CloseButton({ onClick, size = 20, style }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Fermer"
      style={{
        cursor: 'pointer',
        background: 'transparent',
        border: 'none',
        color: 'var(--text-muted)',
        fontSize: size,
        lineHeight: 1,
        padding: 4,
        ...style
      }}
    >×</button>
  );
}
