import { useState } from 'react';
import SegmentedControl from './SegmentedControl.jsx';

const THEME_OPTIONS = [['dark', 'Sombre'], ['light', 'Clair']];

// Version sans auth/multi-organisation (voir backup/dashboard-rewrite-27-08
// pour la version complète) : pas d'onglets "Compte" (mot de passe) ni
// "Organisation" (renommage/suppression), qui n'ont pas de sens ici — un
// seul bot, personne à identifier. Client ID/Guild ID/Token restent
// réglables uniquement via les variables d'environnement (voir README),
// trop sensibles pour une édition sans auth.
const TABS = [
  ['general', 'Général'],
  ['discord', 'Discord'],
  ['collecte', 'Collecte']
];

function SettingsTabs({ active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 4, flexWrap: 'wrap' }}>
      {TABS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          style={{
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            borderBottom: `2px solid ${active === key ? 'var(--accent)' : 'transparent'}`,
            color: active === key ? 'var(--text)' : 'var(--text-muted)',
            cursor: 'pointer',
            marginBottom: -1
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, description, children }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{label}</div>
        {description && <div className="settings-row-desc">{description}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function DiscordSection({ settings, onUpdateSettings, onToast }) {
  const [discordChannelId, setDiscordChannelId] = useState(settings.discordChannelId || '');
  const [discordOwnerId, setDiscordOwnerId] = useState(settings.discordOwnerId || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onUpdateSettings({
        discordChannelId: discordChannelId.trim() || null,
        discordOwnerId: discordOwnerId.trim() || null
      });
      onToast('Identifiants Discord mis à jour');
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="settings-table">
      <Row label="Salon Discord" description="ID du salon où le classement est publié. Prend effet immédiatement.">
        <input className="input mono" value={discordChannelId} onChange={(e) => setDiscordChannelId(e.target.value)} placeholder="1534192470618017822" style={{ width: '100%', maxWidth: 220 }} />
      </Row>
      <Row label="ID Discord (alertes)" description="Reçoit en MP les échecs de scraping, les comptes bloqués et la sauvegarde quotidienne. Prend effet immédiatement.">
        <input className="input mono" value={discordOwnerId} onChange={(e) => setDiscordOwnerId(e.target.value)} placeholder="393160289496858624" style={{ width: '100%', maxWidth: 220 }} />
      </Row>
      <Row label="">
        <button type="submit" className="btn btn-ghost" disabled={saving} style={{ borderRadius: 8 }}>
          {saving ? 'Enregistrement…' : 'Enregistrer les identifiants'}
        </button>
      </Row>
    </form>
  );
}

export default function SettingsView({ settings, onToggle, onUpdateSettings, theme, onThemeChange, onToast }) {
  const [activeTab, setActiveTab] = useState('general');

  const [cronSchedule, setCronSchedule] = useState(settings.cronSchedule || '');
  const [timezone, setTimezone] = useState(settings.timezone || '');
  const [postsLimit, setPostsLimit] = useState(settings.postsLimit || 2);
  const [savingCollecte, setSavingCollecte] = useState(false);

  const saveCollecteSettings = async (e) => {
    e.preventDefault();
    setSavingCollecte(true);
    try {
      await onUpdateSettings({
        cronSchedule: cronSchedule.trim(),
        timezone: timezone.trim(),
        postsLimit: Number(postsLimit)
      });
      onToast('Réglages de collecte mis à jour — posts par plateforme dès la prochaine collecte, heure/fuseau au prochain redémarrage du bot');
    } catch {
      // onUpdateSettings affiche déjà le toast d'erreur (voir App.jsx)
    } finally {
      setSavingCollecte(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
      <SettingsTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === 'general' && (
        <div className="card" style={{ padding: '18px 22px' }}>
          <div className="card-title" style={{ marginBottom: 4 }}>Apparence</div>
          <div className="settings-table">
            <Row label="Thème" description="Préférence enregistrée sur cet appareil.">
              <SegmentedControl options={THEME_OPTIONS} value={theme} onChange={onThemeChange} style={{ width: 152 }} />
            </Row>
          </div>
        </div>
      )}

      {activeTab === 'discord' && (
        <div className="card" style={{ padding: '18px 22px' }}>
          <div className="card-title" style={{ marginBottom: 4 }}>Discord</div>

          <div className="settings-table">
            <Row label="Publier sur Discord" description="Active/désactive l'envoi du classement sur Discord — la collecte a toujours lieu, seule la publication est concernée.">
              <div className={`switch ${settings.notifDaily ? 'on' : ''}`} onClick={() => onToggle('notifDaily', !settings.notifDaily)}>
                <div className="switch-knob" />
              </div>
            </Row>
          </div>

          {settings.notifDaily && (
            <>
              <div className="settings-table">
                <Row label="Alertes de scraping" description="MP au propriétaire en cas d'échec.">
                  <div className={`switch ${settings.notifWarnings ? 'on' : ''}`} onClick={() => onToggle('notifWarnings', !settings.notifWarnings)}>
                    <div className="switch-knob" />
                  </div>
                </Row>
              </div>

              <DiscordSection settings={settings} onUpdateSettings={onUpdateSettings} onToast={onToast} />
            </>
          )}
        </div>
      )}

      {activeTab === 'collecte' && (
        <div className="card" style={{ padding: '18px 22px' }}>
          <div className="card-title" style={{ marginBottom: 4 }}>Collecte</div>
          <form onSubmit={saveCollecteSettings} className="settings-table">
            <Row label="Heure de collecte (cron)" description="Format cron, ex. 30 22 * * *. Effectif au prochain redémarrage du bot.">
              <input className="input mono" value={cronSchedule} onChange={(e) => setCronSchedule(e.target.value)} placeholder="30 22 * * *" style={{ width: '100%', maxWidth: 220 }} />
            </Row>
            <Row label="Fuseau horaire" description="Effectif au prochain redémarrage du bot.">
              <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Paris" style={{ width: '100%', maxWidth: 220 }} />
            </Row>
            <Row label="Posts par plateforme" description="Nombre de publications récentes prises en compte. Effectif dès la prochaine collecte.">
              <input className="input" type="number" min="1" max="20" value={postsLimit} onChange={(e) => setPostsLimit(e.target.value)} style={{ width: '100%', maxWidth: 100 }} />
            </Row>
            <Row label="">
              <button type="submit" className="btn btn-ghost" disabled={savingCollecte} style={{ borderRadius: 8 }}>
                {savingCollecte ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </Row>
          </form>
        </div>
      )}
    </div>
  );
}
