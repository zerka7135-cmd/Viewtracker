// Bloc gris animé qui tient la place d'un contenu en cours de chargement
// (même style que DashboardSkeleton) : on voit la forme de l'écran arriver
// plutôt qu'un « — » ou un « Chargement… ».
export default function Bone({ w = '100%', h = 14, style }) {
  return <div className="skeleton-bone" style={{ width: w, height: h, ...style }} aria-hidden="true" />;
}
