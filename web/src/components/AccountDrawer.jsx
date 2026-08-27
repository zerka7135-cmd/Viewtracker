import { useEffect, useState } from 'react';
import { fmt } from '../format.js';
import { getAccountHistory, deleteAccount as deleteAccountApi } from '../api.js';
import Sparkline from './Sparkline.jsx';
import AreaChart from './AreaChart.jsx';
import AddAccountModal from './AddAccountModal.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import { IconEdit, IconTrash } from './icons.jsx';
import { useEscapeKey } from '../useEscapeKey.js';

const PLATFORMS = [
  { key: 'ig', name: 'Instagram', color: '#e0409e' },
  { key: 'tt', name: 'TikTok', color: '#1a93c0' },
  { key: 'yt', name: 'YouTube', color: '#ff453a' }
];
const RANGES = [7, 14, 30];

// Graphique d'évolution du compte (voir getAccountHistorySeries côté
// serveur) — même composant AreaChart que Dashboard/Historique, mais
// filtré sur ce seul compte plutôt qu'agrégé sur toute l'organisation.
// Chargé à part (pas dans getAccountsWithStats) car il dépend de la
// période/plateforme choisies par l'utilisateur dans le tiroir.
function AccountHistoryChart({ accountName }) {
  const [days, setDays] = useState(14);
  const [platform, setPlatform] = useState('all');
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAccountHistory(accountName, days, platform)
      .then((res) => { if (!cancelled) setSeries(res.series); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountName, days, platform]);

  const chartData = series.map((d) => ({ date: d.date, value: d.value ?? 0 }));
  const hasData = chartData.some((d) => d.value > 0);
  const color = platform === 'all' ? 'var(--accent)' : PLATFORMS.find((p) => p.key === platform).color;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Évolution</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              className="btn"
              onClick={() => setDays(d)}
              style={{
                padding: '5px 10px', borderRadius: 980, fontSize: 11, fontWeight: 600,
                border: `1px solid ${d === days ? 'var(--accent)' : 'var(--border-strong)'}`,
                background: d === days ? 'var(--accent)' : 'transparent',
                color: d === days ? '#fff' : 'var(--text-faint)'
              }}
            >
              {d}j
            </button>
          ))}
          <select className="select" style={{ fontSize: 11, padding: '5px 8px' }} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="all">Toutes plateformes</option>
            <option value="ig">Instagram</option>
            <option value="tt">TikTok</option>
            <option value="yt">YouTube</option>
          </select>
        </div>
      </div>
      <div style={{ background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px' }}>
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '30px 0', textAlign: 'center' }}>Chargement…</div>
        ) : hasData ? (
          <AreaChart data={chartData} color={color} height={120} />
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '30px 0', textAlign: 'center' }}>Pas encore de données sur cette période.</div>
        )}
      </div>
    </div>
  );
}

// Modifier/Supprimer réutilisent AddAccountModal (mode édition) et la même
// route de suppression que le tableau de comptes de Dashboard (DashboardView.jsx)
// — le tiroir de détail est un autre point d'entrée vers le même compte,
// pas une fonctionnalité séparée.
export default function AccountDrawer({ account, onClose, onAccountsChanged, onToast }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEscapeKey(onClose, Boolean(account) && !editing && !deleting);

  if (!account) return null;

  const confirmDelete = async () => {
    try {
      const res = await deleteAccountApi(account.name);
      onAccountsChanged(res.accounts);
      onToast(`Compte "${account.name}" supprimé`);
      setDeleting(false);
      onClose();
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    }
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="drawer">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{account.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {fmt(account.allTime.total)} vues cumulées (all-time)
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button type="button" className="icon-btn" title="Modifier" aria-label="Modifier le compte" onClick={() => setEditing(true)}>
              <IconEdit size={15} />
            </button>
            <button type="button" className="icon-btn icon-btn-danger" title="Supprimer" aria-label="Supprimer le compte" onClick={() => setDeleting(true)}>
              <IconTrash size={15} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: 4, marginLeft: 4 }}
            >×</button>
          </div>
        </div>

        {editing && (
          <AddAccountModal
            account={account}
            onClose={() => setEditing(false)}
            onAdded={(updated) => { onAccountsChanged(updated); setEditing(false); }}
            onToast={onToast}
          />
        )}
        {deleting && (
          <ConfirmModal
            title="Supprimer le compte"
            message={<>Supprimer <strong>{account.name}</strong> ? Son historique de vues sera perdu.</>}
            confirmLabel="Supprimer"
            onConfirm={confirmDelete}
            onCancel={() => setDeleting(false)}
          />
        )}

        {/* Remonté à chaque ouverture d'un compte différent (key=account.name)
            pour repartir sur la période/plateforme par défaut plutôt que de
            garder l'état du compte précédemment consulté. */}
        <AccountHistoryChart key={account.name} accountName={account.name} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {PLATFORMS.map((p) => (
            <div key={p.key} style={{ background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="dot" style={{ background: p.color }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                </div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                  {account[p.key] === null ? 'Ban' : fmt(account[p.key])}
                </div>
              </div>
              <Sparkline values={account.spark} color={p.color} />
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Derniers posts scrapés</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PLATFORMS.flatMap((p) => account.posts[p.key].map((post) => ({ ...post, platform: p }))).map((post, i) => (
              <a
                key={`${post.platform.key}-${post.id}-${i}`}
                href={post.url || undefined}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px',
                  background: 'var(--card-alt)', borderRadius: 10, fontSize: 12.5, textDecoration: 'none', color: 'inherit'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="dot" style={{ background: post.platform.color }} />
                  <div style={{ color: 'var(--text-faint)' }}>{post.platform.name}</div>
                </div>
                <div className="mono" style={{ fontWeight: 600 }}>{fmt(post.views)}</div>
              </a>
            ))}
            {PLATFORMS.every((p) => account.posts[p.key].length === 0) && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pas encore de posts scrapés pour ce compte.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
