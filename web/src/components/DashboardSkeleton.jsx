// Squelette affiché pendant le premier chargement du Dashboard (voir
// App.jsx : `loaded && kpis` bascule vers le vrai contenu) — reprend la
// même disposition (3 cartes KPI, graphique, tableau) pour que
// l'apparition du vrai contenu ne "saute" pas d'une mise en page à une
// autre. Remplace l'ancien loader plein écran, qui masquait toute la
// sidebar/topbar pendant l'attente au lieu de les afficher tout de suite.
function Bone({ width, height = 14, style }) {
  return <div className="skeleton-bone" style={{ width, height, ...style }} />;
}

export default function DashboardSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }} aria-hidden="true">
      <div className="kpi-grid">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card kpi-card">
            <Bone width="55%" height={11} />
            <Bone width="70%" height={26} style={{ marginTop: 10 }} />
            <Bone width="45%" height={11} style={{ marginTop: 10 }} />
          </div>
        ))}
      </div>

      <div className="content-grid">
        <div className="stack">
          <div className="card" style={{ padding: '20px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
              <Bone width={180} height={16} />
              <Bone width={140} height={26} style={{ borderRadius: 980 }} />
            </div>
            <Bone width="100%" height={220} style={{ borderRadius: 12 }} />
          </div>

          <div className="card" style={{ padding: '20px 22px' }}>
            <Bone width={200} height={16} style={{ marginBottom: 18 }} />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: i < 4 ? '1px solid var(--table-row-border)' : 'none' }}>
                <Bone width={18} height={14} />
                <Bone width="30%" height={14} />
                <Bone width={50} height={14} style={{ marginLeft: 'auto' }} />
                <Bone width={50} height={14} />
                <Bone width={50} height={14} />
                <Bone width={60} height={14} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
