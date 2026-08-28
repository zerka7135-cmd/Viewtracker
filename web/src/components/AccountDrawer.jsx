import { useEffect, useState } from 'react';
import { fmt } from '../format.js';
import { getAccountHistory, deleteAccount as deleteAccountApi } from '../api.js';
import Sparkline from './Sparkline.jsx';
import AreaChart from './AreaChart.jsx';
import AddAccountModal from './AddAccountModal.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import { IconEdit, IconTrash, IconDownload } from './icons.jsx';
import { useEscapeKey } from '../useEscapeKey.js';
import { useSwipeToClose } from '../useSwipeToClose.js';
import CloseButton from './CloseButton.jsx';
import SheetHandle from './SheetHandle.jsx';
import { downloadPdf } from '../pdf.js';

const PLATFORMS = [
  { key: 'ig', name: 'Instagram', color: '#e0409e' },
  { key: 'tt', name: 'TikTok', color: '#1a93c0' },
  { key: 'yt', name: 'YouTube', color: '#ff453a' }
];
const RANGES = [7, 14, 30];

// Graphique d'évolution du compte (voir getAccountHistorySeries côté
// serveur) — même composant AreaChart que Dashboard/Historique, mais
// filtré sur ce seul compte plutôt qu'agrégé sur toute l'organisation.
// Purement présentation : période/plateforme et export PDF sont pilotés
// par AccountDrawer (voir plus bas) — le bouton de téléchargement a
// rejoint les autres actions du header plutôt que de rester isolé ici.
function AccountHistoryChart({ days, onDaysChange, platform, onPlatformChange, loading, hasData, chartData, color }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Évolution</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              className="btn"
              onClick={() => onDaysChange(d)}
              style={{
                padding: '5px 10px', borderRadius: 980, fontSize: 11, fontWeight: 600,
                border: `1px solid ${d === days ? 'var(--accent)' : 'color-mix(in oklab, var(--accent) 55%, transparent)'}`,
                background: d === days ? 'var(--accent)' : 'transparent',
                color: d === days ? '#fff' : 'var(--accent)'
              }}
            >
              {d}j
            </button>
          ))}
          <select className="select" style={{ fontSize: 11, padding: '5px 8px' }} value={platform} onChange={(e) => onPlatformChange(e.target.value)}>
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
  // `account` passe à null dès la demande de fermeture (voir App.jsx) —
  // sans ce state local, le tiroir démonterait instantanément au lieu de
  // jouer son animation de sortie (voir theme.css#slideOut). On garde le
  // dernier compte affiché le temps de l'animation plutôt que de le
  // perdre immédiatement.
  const [displayedAccount, setDisplayedAccount] = useState(account);
  const [closing, setClosing] = useState(false);

  // Période/plateforme du graphique d'évolution + état d'export PDF —
  // portés ici (plutôt que dans AccountHistoryChart) pour que le bouton de
  // téléchargement puisse rejoindre les autres actions du header (voir
  // plus bas) au lieu de rester isolé à côté du sélecteur de période.
  const [days, setDays] = useState(14);
  const [platform, setPlatform] = useState('all');
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (account) {
      setDisplayedAccount(account);
      setClosing(false);
    } else if (displayedAccount) {
      setClosing(true);
      const timer = setTimeout(() => setDisplayedAccount(null), 200);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  // Repart sur la période/plateforme par défaut à chaque changement de
  // compte affiché — avant la fusion du bouton d'export dans le header,
  // un `key={shown.name}` sur AccountHistoryChart obtenait ce même effet
  // via un remount complet ; l'état étant maintenant ici, il faut le
  // réinitialiser explicitement.
  useEffect(() => {
    setDays(14);
    setPlatform('all');
  }, [displayedAccount?.name]);

  useEffect(() => {
    if (!displayedAccount) return;
    let cancelled = false;
    setLoading(true);
    getAccountHistory(displayedAccount.name, days, platform)
      .then((res) => { if (!cancelled) setSeries(res.series); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [displayedAccount?.name, days, platform]);

  useEscapeKey(onClose, Boolean(account) && !editing && !deleting);
  // Balayage vers le bas depuis la poignée pour fermer, sur mobile
  // uniquement (voir useSwipeToClose.js) — même geste que la croix/le tap
  // sur le fond, juste plus rapide au pouce sur une feuille plein écran.
  const { sheetRef, handleProps } = useSwipeToClose(onClose);

  if (!displayedAccount) return null;
  const shown = displayedAccount;

  const chartData = series.map((d) => ({ date: d.date, value: d.value ?? 0 }));
  const hasData = chartData.some((d) => d.value > 0);
  const color = platform === 'all' ? 'var(--accent)' : PLATFORMS.find((p) => p.key === platform).color;

  const exportPdf = async () => {
    setExporting(true);
    try {
      const filename = `viewtracker-${shown.name}-${platform}-${days}j`;
      const rows = chartData.map((d) => [d.date, d.value]);
      const rangeLabel = platform === 'all' ? 'Toutes plateformes' : PLATFORMS.find((p) => p.key === platform).name;
      const summary = [
        ['Total cumulé', fmt(shown.allTime.total)],
        ['Instagram', shown.ig === null ? 'Ban' : fmt(shown.allTime.ig)],
        ['TikTok', shown.tt === null ? 'Ban' : fmt(shown.allTime.tt)],
        ['YouTube', shown.yt === null ? 'Ban' : fmt(shown.allTime.yt)]
      ];
      await downloadPdf(filename, shown.name, `${rangeLabel} — ${days} derniers jours`, summary, ['Date', 'Vues'], rows);
    } catch (err) {
      onToast(`Erreur export PDF : ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const confirmDelete = async () => {
    try {
      const res = await deleteAccountApi(shown.name);
      onAccountsChanged(res.accounts);
      onToast(`Compte "${shown.name}" supprimé`);
      setDeleting(false);
      onClose();
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    }
  };

  return (
    <>
      <div className={`backdrop ${closing ? 'is-exiting' : ''}`} onClick={onClose} />
      <div className={`drawer ${closing ? 'is-exiting' : ''}`} ref={sheetRef}>
        <SheetHandle {...handleProps} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{shown.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {fmt(shown.allTime.total)} vues cumulées
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button type="button" className="icon-btn" title="Exporter en PDF" aria-label="Exporter l'évolution en PDF" onClick={exportPdf} disabled={!hasData || exporting}>
              {exporting ? <span className="login-spinner" /> : <IconDownload size={15} />}
            </button>
            <button type="button" className="icon-btn" title="Modifier" aria-label="Modifier le compte" onClick={() => setEditing(true)}>
              <IconEdit size={15} />
            </button>
            <button type="button" className="icon-btn icon-btn-danger" title="Supprimer" aria-label="Supprimer le compte" onClick={() => setDeleting(true)}>
              <IconTrash size={15} />
            </button>
            <CloseButton onClick={onClose} size={22} style={{ marginLeft: 4 }} />
          </div>
        </div>

        {editing && (
          <AddAccountModal
            account={shown}
            onClose={() => setEditing(false)}
            onAdded={(updated) => { onAccountsChanged(updated); setEditing(false); }}
            onToast={onToast}
          />
        )}
        {deleting && (
          <ConfirmModal
            title="Supprimer le compte"
            message={<>Supprimer <strong>{shown.name}</strong> ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>Son historique de vues sera perdu, définitivement.</span></>}
            confirmLabel="Supprimer"
            onConfirm={confirmDelete}
            onCancel={() => setDeleting(false)}
          />
        )}

        <AccountHistoryChart
          days={days}
          onDaysChange={setDays}
          platform={platform}
          onPlatformChange={setPlatform}
          loading={loading}
          hasData={hasData}
          chartData={chartData}
          color={color}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {PLATFORMS.map((p) => (
            <div key={p.key} style={{ background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="dot" style={{ background: p.color }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                </div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                  {shown[p.key] === null ? 'Ban' : fmt(shown[p.key])}
                </div>
              </div>
              <Sparkline values={shown.spark} color={p.color} />
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Derniers posts scrapés</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PLATFORMS.flatMap((p) => shown.posts[p.key].map((post) => ({ ...post, platform: p }))).map((post, i) => (
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
            {PLATFORMS.every((p) => shown.posts[p.key].length === 0) && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pas encore de posts scrapés pour ce compte.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
