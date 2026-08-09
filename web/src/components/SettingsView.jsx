import { useEffect, useState } from 'react';
import { changePassword, renameOrganization, getBotConfig, updateBotConfig } from '../api.js';
import PasswordInput from './PasswordInput.jsx';
import DeleteOrganizationModal from './DeleteOrganizationModal.jsx';
import SegmentedControl from './SegmentedControl.jsx';

const THEME_OPTIONS = [['dark', 'Sombre'], ['light', 'Clair']];

const TABS = [
  ['general', 'Général'],
  ['discord', 'Discord'],
  ['collecte', 'Collecte'],
  ['compte', 'Compte'],
  ['organisation', 'Organisation']
];

// Onglets pour naviguer entre les rubriques — remplace le long scroll
// unique d'avant, devenu difficile à parcourir à mesure que les réglages
// se sont accumulés (Discord, collecte, bot, mot de passe, organisation…).
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

// Séparateur discret entre deux sous-sections d'une même carte (ex. les
// réglages de diffusion vs les identifiants du bot, tous les deux "à
// propos de Discord" mais avec des sources/actions de sauvegarde
// distinctes — voir la carte "Discord" plus bas).
function SubsectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', margin: '18px 0 2px' }}>
      {children}
    </div>
  );
}

function ChangePasswordSection({ onToast }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await changePassword(current, next);
      onToast('Mot de passe mis à jour');
      setCurrent('');
      setNext('');
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="settings-table">
      <Row label="Mot de passe actuel">
        <PasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} style={{ width: '100%', maxWidth: 220 }} />
      </Row>
      <Row label="Nouveau mot de passe" description="Au moins 8 caractères.">
        <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} style={{ width: '100%', maxWidth: 220 }} />
      </Row>
      <Row label="">
        <button type="submit" className="btn btn-ghost" disabled={saving || !current || !next} style={{ borderRadius: 8 }}>
          {saving ? 'Mise à jour…' : 'Changer le mot de passe'}
        </button>
      </Row>
    </form>
  );
}

function OrganizationSection({ session, onOrgRenamed, onToast }) {
  const [name, setName] = useState(session.orgName);
  const [saving, setSaving] = useState(false);
  const canRename = session.role === 'owner' || session.role === 'manager';

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await renameOrganization(name.trim());
      onOrgRenamed(res.orgName);
      onToast('Organisation renommée');
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="settings-table">
      <Row label="Nom de l'organisation" description={!canRename ? 'Réservé aux propriétaires/managers.' : undefined}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canRename} style={{ width: '100%', maxWidth: 220 }} />
      </Row>
      {canRename && (
        <Row label="">
          <button type="submit" className="btn btn-ghost" disabled={saving || !name.trim() || name === session.orgName} style={{ borderRadius: 8 }}>
            {saving ? 'Enregistrement…' : 'Renommer'}
          </button>
        </Row>
      )}
    </form>
  );
}

// Tous les identifiants Discord regroupés dans un seul formulaire — salons
// et destinataire d'alerte (réglages par organisation, à chaud) ainsi que
// Client ID/Guild ID (identifiants du bot lui-même, .env, effet après
// redémarrage) : ce sont deux sources de données différentes côté serveur
// (onUpdateSettings vs updateBotConfig), mais un seul bouton "Enregistrer"
// les envoie ensemble pour ne pas faire éclater visuellement ce qui est
// conceptuellement le même groupe ("les identifiants"). Le Token reste à
// part (secret, pas un identifiant, propre champ masqué juste en dessous).
function DiscordIdentifiersSection({ settings, onUpdateSettings, isOwner, onToast }) {
  const [discordChannelId, setDiscordChannelId] = useState(settings.discordChannelId || '');
  const [discordOwnerId, setDiscordOwnerId] = useState(settings.discordOwnerId || '');
  const [clientId, setClientId] = useState('');
  const [guildId, setGuildId] = useState('');
  const [token, setToken] = useState('');
  const [botStatus, setBotStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingToken, setSavingToken] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    getBotConfig().then((res) => {
      setBotStatus(res);
      setClientId(res.discordClientId || '');
      setGuildId(res.discordGuildId || '');
    }).catch(() => {});
  }, [isOwner]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onUpdateSettings({
        discordChannelId: discordChannelId.trim() || null,
        discordOwnerId: discordOwnerId.trim() || null
      });
      if (isOwner) {
        const res = await updateBotConfig({ discordClientId: clientId.trim(), discordGuildId: guildId.trim() });
        setBotStatus(res);
      }
      onToast('Identifiants Discord mis à jour');
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const submitToken = async (e) => {
    e.preventDefault();
    if (!token.trim()) return;
    setSavingToken(true);
    try {
      const res = await updateBotConfig({ discordToken: token.trim() });
      setBotStatus(res);
      setToken('');
      onToast('Token enregistré — redémarre le bot (npm start) pour l\'appliquer');
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    } finally {
      setSavingToken(false);
    }
  };

  return (
    <>
      <form onSubmit={submit} className="settings-table">
        <Row label="Salons Discord" description="Un ID par ligne (ou séparés par une virgule) — le classement est posté dans chacun. Prend effet immédiatement.">
          <textarea
            className="input mono"
            value={discordChannelId}
            onChange={(e) => setDiscordChannelId(e.target.value)}
            placeholder={'1534192470618017822\n987654321012345678'}
            rows={3}
            style={{ width: '100%', maxWidth: 220, resize: 'vertical', fontSize: 12 }}
          />
        </Row>
        <Row label="ID Discord (alertes)" description="Reçoit en MP les échecs de scraping et les comptes bloqués. Prend effet immédiatement.">
          <input className="input mono" value={discordOwnerId} onChange={(e) => setDiscordOwnerId(e.target.value)} placeholder="393160289496858624" style={{ width: '100%', maxWidth: 220 }} />
        </Row>
        {isOwner && (
          <>
            <Row label="Client ID" description="Identifiant public de l'application Discord. Effet après redémarrage du bot.">
              <input className="input mono" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1532477198693568783" style={{ width: '100%', maxWidth: 220 }} />
            </Row>
            <Row label="Guild ID" description="Identifie le serveur Discord associé. Effet après redémarrage du bot.">
              <input className="input mono" value={guildId} onChange={(e) => setGuildId(e.target.value)} placeholder="1532474290908430346" style={{ width: '100%', maxWidth: 220 }} />
            </Row>
          </>
        )}
        <Row label="">
          <button type="submit" className="btn btn-ghost" disabled={saving} style={{ borderRadius: 8 }}>
            {saving ? 'Enregistrement…' : 'Enregistrer les identifiants'}
          </button>
        </Row>
      </form>

      {isOwner && botStatus && (
        <>
          <SubsectionLabel>Token du bot</SubsectionLabel>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
            Secret, pas un identifiant — reste à part. Effet après redémarrage du bot (<span className="mono">npm start</span>).
          </div>
          <form onSubmit={submitToken} className="settings-table">
            <Row label="Token" description="Laisser vide pour ne pas le changer.">
              <PasswordInput
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={botStatus.hasToken ? `Configuré (${botStatus.tokenPreview})` : 'Aucun token configuré'}
                style={{ width: '100%', maxWidth: 220 }}
              />
            </Row>
            <Row label="">
              <button type="submit" className="btn btn-ghost" disabled={savingToken || !token.trim()} style={{ borderRadius: 8 }}>
                {savingToken ? 'Enregistrement…' : 'Enregistrer le token'}
              </button>
            </Row>
          </form>
        </>
      )}
    </>
  );
}

export default function SettingsView({ settings, onToggle, onUpdateSettings, session, onOrgRenamed, onOrgDeleted, onToast, theme, onThemeChange }) {
  const [activeTab, setActiveTab] = useState('general');

  const [cronSchedule, setCronSchedule] = useState(settings.cronSchedule || '');
  const [timezone, setTimezone] = useState(settings.timezone || '');
  const [postsLimit, setPostsLimit] = useState(settings.postsLimit || 5);
  const [savingCollecte, setSavingCollecte] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const saveCollecteSettings = async (e) => {
    e.preventDefault();
    setSavingCollecte(true);
    try {
      await onUpdateSettings({
        cronSchedule: cronSchedule.trim(),
        timezone: timezone.trim(),
        postsLimit: Number(postsLimit)
      });
      onToast('Réglages de collecte mis à jour');
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

      {/* Tout ce qui concerne Discord regroupé dans une seule carte —
          notifications d'abord, puis TOUS les identifiants ensemble
          (salons, alertes, Client ID, Guild ID — voir
          DiscordIdentifiersSection), le Token restant à part car ce n'est
          pas un identifiant mais un secret. La collecte (planification/
          posts) a son propre onglet : ce n'est pas spécifique à Discord,
          ces réglages existeraient même sans diffusion. */}
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

          {/* Tant que la publication est désactivée, aucun des réglages
              ci-dessous n'a d'effet — inutile de les afficher et de
              donner l'impression qu'ils font quelque chose. */}
          {settings.notifDaily && (
            <>
              <div className="settings-table">
                <Row label="Alertes de scraping" description="MP au propriétaire en cas d'échec.">
                  <div className={`switch ${settings.notifWarnings ? 'on' : ''}`} onClick={() => onToggle('notifWarnings', !settings.notifWarnings)}>
                    <div className="switch-knob" />
                  </div>
                </Row>
              </div>

              <SubsectionLabel>Identifiants</SubsectionLabel>
              <DiscordIdentifiersSection
                settings={settings}
                onUpdateSettings={onUpdateSettings}
                isOwner={session.role === 'owner'}
                onToast={onToast}
              />
            </>
          )}
        </div>
      )}

      {activeTab === 'collecte' && (
        <div className="card" style={{ padding: '18px 22px' }}>
          <div className="card-title" style={{ marginBottom: 4 }}>Collecte</div>
          <form onSubmit={saveCollecteSettings} className="settings-table">
            <Row label="Heure de collecte (cron)" description="Format cron, ex. 30 22 * * *.">
              <input className="input mono" value={cronSchedule} onChange={(e) => setCronSchedule(e.target.value)} placeholder="30 22 * * *" style={{ width: '100%', maxWidth: 220 }} />
            </Row>
            <Row label="Fuseau horaire">
              <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Paris" style={{ width: '100%', maxWidth: 220 }} />
            </Row>
            <Row label="Posts par plateforme" description="Nombre de publications récentes prises en compte.">
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

      {activeTab === 'compte' && (
        <div className="card" style={{ padding: '18px 22px' }}>
          <div className="card-title" style={{ marginBottom: 4 }}>Mot de passe</div>
          <ChangePasswordSection onToast={onToast} />
        </div>
      )}

      {activeTab === 'organisation' && (
        <>
          <div className="card" style={{ padding: '18px 22px' }}>
            <div className="card-title" style={{ marginBottom: 4 }}>Organisation</div>
            <OrganizationSection session={session} onOrgRenamed={onOrgRenamed} onToast={onToast} />
          </div>

          {session.role === 'owner' && (
            <div className="card" style={{ padding: '18px 22px', border: '1px solid rgba(255,69,58,0.3)' }}>
              <div className="card-title" style={{ marginBottom: 4, color: 'var(--red)' }}>Zone dangereuse</div>
              <div className="settings-table">
                <Row label="Supprimer l'organisation" description="Efface définitivement comptes suivis, historique, cumul et membres. Irréversible.">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowDeleteModal(true)}
                    style={{ borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, color: 'var(--red)', background: 'transparent', border: '1px solid var(--red)' }}
                  >
                    Supprimer…
                  </button>
                </Row>
              </div>
            </div>
          )}
        </>
      )}

      {showDeleteModal && (
        <DeleteOrganizationModal
          orgName={session.orgName}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={onOrgDeleted}
          onToast={onToast}
        />
      )}
    </div>
  );
}
