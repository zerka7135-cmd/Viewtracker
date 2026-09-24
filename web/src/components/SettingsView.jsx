import { useEffect, useState } from 'react';
import { getBotConfig, updateBotConfig, changePassword } from '../api.js';
import { IconLogout } from './icons.jsx';

// Version sans multi-organisation (voir backup/dashboard-rewrite-27-08
// pour cette version-là, qui a besoin de Postgres) : pas d'onglet
// "Organisation" (renommage/suppression), qui n'a pas de sens ici — un
// seul bot. "Compte" existe en revanche : mot de passe (la gestion des
// membres et de leurs rôles vit dans la page Gestion, voir ManagementView.jsx). Pas d'onglet "Général" :
// il ne portait que le choix de thème clair/sombre, retiré (l'app ne
// propose plus que le thème sombre, voir theme.css/theme.js).
const TABS = [
  ['discord', 'Discord'],
  ['collecte', 'Collecte'],
  ['compte', 'Compte']
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

// Interrupteur accessible — remplace un <div onClick> qui n'était ni
// focusable au clavier ni activable par Entrée/Espace (voir aussi le
// même correctif appliqué à Sidebar.jsx#nav-item). role="switch" +
// aria-checked porte l'état pour les lecteurs d'écran.
function Switch({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <div className="switch-knob" />
    </button>
  );
}

function SubsectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', margin: '18px 0 2px' }}>
      {children}
    </div>
  );
}

function DiscordSection({ settings, onUpdateSettings, onToast }) {
  const [discordChannelId, setDiscordChannelId] = useState(settings.discordChannelId || '');
  const [discordOwnerId, setDiscordOwnerId] = useState(settings.discordOwnerId || '');
  const [stuckAlertMinDays, setStuckAlertMinDays] = useState(settings.stuckAlertMinDays || 3);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onUpdateSettings({
        discordChannelId: discordChannelId.trim() || null,
        discordOwnerId: discordOwnerId.trim() || null,
        stuckAlertMinDays: Number(stuckAlertMinDays)
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
      <Row label="Seuil avant alerte « compte bloqué »" description="Nombre de collectes consécutives en échec sur un compte/plateforme avant le MP dédié (cookie expiré, sélecteur cassé...). Prend effet immédiatement.">
        <input className="input" type="number" min="1" max="30" value={stuckAlertMinDays} onChange={(e) => setStuckAlertMinDays(e.target.value)} style={{ width: '100%', maxWidth: 100 }} />
      </Row>
      <Row label="">
        <button type="submit" className="btn btn-ghost" disabled={saving} style={{ borderRadius: 8 }}>
          {saving ? 'Enregistrement…' : 'Enregistrer les identifiants'}
        </button>
      </Row>
    </form>
  );
}

// Client ID/Guild ID/Token du bot lui-même — distincts des réglages
// ci-dessus (salon/destinataire/alertes, propres à l'usage du bot) : ce
// sont les identifiants de connexion à Discord. Un override enregistré ici
// prend le dessus sur la variable d'environnement (voir botConfig.js),
// donc fonctionne aussi sur un hébergeur comme Railway où ces variables
// ne viennent pas d'un .env. Effet après redémarrage du bot (npm start).
//
// ⚠️ Un seul mot de passe protège tout le dashboard (voir auth.js) —
// quiconque le connaît peut remplacer ces identifiants et prendre le
// contrôle du bot. Le token n'est jamais renvoyé en clair par l'API,
// seulement un aperçu masqué.
function BotIdentitySection({ onToast }) {
  const [status, setStatus] = useState(null);
  const [clientId, setClientId] = useState('');
  const [guildId, setGuildId] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingToken, setSavingToken] = useState(false);

  useEffect(() => {
    getBotConfig().then((res) => {
      setStatus(res);
      setClientId(res.discordClientId || '');
      setGuildId(res.discordGuildId || '');
    }).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await updateBotConfig({ discordClientId: clientId.trim(), discordGuildId: guildId.trim() });
      setStatus(res);
      onToast('Client ID / Guild ID mis à jour — effectif au prochain redémarrage du bot');
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
      setStatus(res);
      setToken('');
      onToast('Token enregistré — redémarre le bot pour l\'appliquer');
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    } finally {
      setSavingToken(false);
    }
  };

  if (!status) return null;

  return (
    <div style={{ padding: '14px 16px', marginTop: 4, border: '1px solid color-mix(in oklab, var(--orange) 30%, transparent)', borderRadius: 10 }}>
      <SubsectionLabel>Identifiants du bot</SubsectionLabel>
      <div style={{ fontSize: 11.5, color: 'var(--orange)', marginBottom: 6, lineHeight: 1.5 }}>
        ⚠ Quiconque connaît le mot de passe du dashboard peut changer ces valeurs et prendre le contrôle du bot — gardez-le aussi confidentiel que le token lui-même.
      </div>

      <form onSubmit={submit} className="settings-table">
        <Row label="Client ID" description="Identifiant public de l'application Discord. Effet après redémarrage.">
          <input className="input mono" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1532477198693568783" style={{ width: '100%', maxWidth: 220 }} />
        </Row>
        <Row label="Guild ID" description="Identifie le serveur Discord associé. Effet après redémarrage.">
          <input className="input mono" value={guildId} onChange={(e) => setGuildId(e.target.value)} placeholder="1532474290908430346" style={{ width: '100%', maxWidth: 220 }} />
        </Row>
        <Row label="">
          <button type="submit" className="btn btn-ghost" disabled={saving} style={{ borderRadius: 8 }}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </Row>
      </form>

      <SubsectionLabel>Token du bot</SubsectionLabel>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
        Secret, jamais réaffiché en clair — reste à part. Effet après redémarrage.
      </div>
      <form onSubmit={submitToken} className="settings-table">
        <Row label="Token" description="Laisser vide pour ne pas le changer.">
          <input
            className="input mono"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={status.hasToken ? `Configuré (${status.tokenPreview})` : 'Aucun token configuré'}
            style={{ width: '100%', maxWidth: 220 }}
          />
        </Row>
        <Row label="">
          <button type="submit" className="btn btn-ghost" disabled={savingToken || !token.trim()} style={{ borderRadius: 8 }}>
            {savingToken ? 'Enregistrement…' : 'Enregistrer le token'}
          </button>
        </Row>
      </form>
    </div>
  );
}

function ChangePasswordSection({ onToast }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) {
      onToast('Erreur : les deux mots de passe ne correspondent pas');
      return;
    }
    setSaving(true);
    try {
      await changePassword(current, next);
      onToast('Mot de passe mis à jour');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      onToast(`Erreur : ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ padding: '18px 22px' }}>
      <div className="card-title" style={{ marginBottom: 4 }}>Mot de passe</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
        Concerne uniquement ton compte — le changer déconnecte tes propres appareils déjà connectés, pas ceux des autres comptes.
      </div>
      <form onSubmit={submit} className="settings-table">
        <Row label="Mot de passe actuel">
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} style={{ width: '100%', maxWidth: 220 }} />
        </Row>
        <Row label="Nouveau mot de passe" description="Au moins 8 caractères.">
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} style={{ width: '100%', maxWidth: 220 }} />
        </Row>
        <Row label="Confirmer">
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ width: '100%', maxWidth: 220 }} />
        </Row>
        <Row label="">
          <button type="submit" className="btn btn-ghost" disabled={saving || !current || !next} style={{ borderRadius: 8 }}>
            {saving ? 'Mise à jour…' : 'Changer le mot de passe'}
          </button>
        </Row>
      </form>
    </div>
  );
}

// Ne concerne que l'appareil courant (voir handleLogout dans App.jsx) —
// rendu ici plutôt qu'en bouton flottant, car c'est le seul endroit
// garanti accessible sur toutes les tailles d'écran : la Sidebar (qui
// porte aussi la déconnexion) est masquée sur mobile au profit de
// MobileTabBar, qui n'a pas de place pour un 3e bouton (voir
// MobileTabBar.jsx).
function LogoutSection({ onLogout }) {
  return (
    <div className="card" style={{ padding: '18px 22px' }}>
      <div className="card-title" style={{ marginBottom: 4 }}>Session</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
        Déconnecte cet appareil — les autres comptes/appareils ne sont pas affectés.
      </div>
      <button type="button" className="btn btn-ghost" onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8 }}>
        <IconLogout size={14} />
        Se déconnecter
      </button>
    </div>
  );
}


// Comptes autorisés à se connecter au dashboard (voir auth.js) — pas de
// rôle admin distinct, n'importe quel compte déjà connecté peut en
// ajouter/retirer d'autres.

export default function SettingsView({ role, settings, onToggle, onUpdateSettings, onToast, onLogout }) {
  // Seul l'admin règle le bot, la collecte et les membres (ces derniers sont
  // dans Gestion) ; manager et clipper n'ont que leur compte (mot de passe).
  const isAdmin = role === 'admin';
  const [activeTab, setActiveTab] = useState(isAdmin ? 'discord' : 'compte');

  const [cronSchedule, setCronSchedule] = useState(settings.cronSchedule || '');
  const [timezone, setTimezone] = useState(settings.timezone || '');
  const [postsLimit, setPostsLimit] = useState(settings.postsLimit || 2);
  const [commissionPerClick, setCommissionPerClick] = useState(settings.commissionPerClick ?? 0.18);
  const [cashConversionRate, setCashConversionRate] = useState(settings.cashConversionRate ?? 0.8732);
  const [savingCollecte, setSavingCollecte] = useState(false);

  const saveCollecteSettings = async (e) => {
    e.preventDefault();
    setSavingCollecte(true);
    try {
      await onUpdateSettings({
        cronSchedule: cronSchedule.trim(),
        timezone: timezone.trim(),
        postsLimit: Number(postsLimit),
        commissionPerClick: Number(commissionPerClick),
        cashConversionRate: Number(cashConversionRate)
      });
      onToast('Réglages de collecte mis à jour — posts par plateforme dès la prochaine collecte, heure/fuseau au prochain redémarrage du bot');
    } catch {
      // onUpdateSettings affiche déjà le toast d'erreur (voir App.jsx)
    } finally {
      setSavingCollecte(false);
    }
  };

  // Chaque panneau reste monté en permanence (juste masqué via `hidden`
  // plutôt que démonté/remonté par un `&&` conditionnel) : avec un rendu
  // conditionnel classique, changer d'onglet avant d'enregistrer perdait
  // silencieusement toute saisie en cours dans les champs non contrôlés
  // par `settings` (ex. taper un nouveau salon Discord, aller voir l'onglet
  // Collecte, revenir sur Discord — le champ était réinitialisé sans
  // aucun avertissement). `hidden` retire le panneau du rendu visuel et de
  // la navigation clavier (comme display:none) sans perdre son état React.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
      {isAdmin && <SettingsTabs active={activeTab} onChange={setActiveTab} />}

      {isAdmin && <div style={{ display: activeTab !== 'discord' ? 'none' : 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="card" style={{ padding: '18px 22px' }}>
          <div className="card-title" style={{ marginBottom: 4 }}>Discord</div>

          <div className="settings-table">
            <Row label="Publier sur Discord" description="Active/désactive l'envoi du classement sur Discord — la collecte a toujours lieu, seule la publication est concernée.">
              <Switch checked={settings.notifDaily} onChange={(v) => onToggle('notifDaily', v)} />
            </Row>
            <Row label="Alertes de scraping" description="MP au propriétaire en cas d'échec. Indépendant de la publication du classement ci-dessus.">
              <Switch checked={settings.notifWarnings} onChange={(v) => onToggle('notifWarnings', v)} />
            </Row>
          </div>

          {/* Salon/ID owner/seuil d'alerte : champs de config indépendants
              des deux interrupteurs ci-dessus (ex. DISCORD_OWNER_ID sert
              aussi aux alertes "compte bloqué" et à la sauvegarde
              quotidienne, voir .env.example — les masquer quand "Publier
              sur Discord" est désactivé empêchait de les renseigner à
              l'avance). Toujours visibles, comme les autres champs
              modifiables du .env ci-dessous. */}
          <DiscordSection settings={settings} onUpdateSettings={onUpdateSettings} onToast={onToast} />

          <BotIdentitySection onToast={onToast} />
        </div>
      </div>}

      {isAdmin && <div className="card" style={{ padding: '18px 22px' }} hidden={activeTab !== 'collecte'}>
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
          <Row label="Tarif par clic par défaut (€)" description="Montant versé pour chaque clic à un clipper qui n'a pas de tarif propre (réglable par clipper dans Gestion). Sert à « À payer », au bénéfice et au ROAS. Effectif immédiatement.">
            <input className="input" type="number" min="0" step="0.01" value={commissionPerClick} onChange={(e) => setCommissionPerClick(e.target.value)} style={{ width: '100%', maxWidth: 100 }} />
          </Row>
          <Row label="Coefficient cash → €" description="Le cash de la source (en dollars) est multiplié par ce coefficient pour l'afficher en euros. 1 = aucune conversion. Effectif immédiatement.">
            <input className="input" type="number" min="0.0001" step="0.0001" value={cashConversionRate} onChange={(e) => setCashConversionRate(e.target.value)} style={{ width: '100%', maxWidth: 120 }} />
          </Row>
          <Row label="">
            <button type="submit" className="btn btn-ghost" disabled={savingCollecte} style={{ borderRadius: 8 }}>
              {savingCollecte ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </Row>
        </form>
      </div>}

      <div style={{ display: activeTab !== 'compte' ? 'none' : 'flex', flexDirection: 'column', gap: 20 }}>
        <ChangePasswordSection onToast={onToast} />
        <LogoutSection onLogout={onLogout} />
      </div>
    </div>
  );
}
