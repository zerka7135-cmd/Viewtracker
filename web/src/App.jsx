import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import Sidebar from './components/Sidebar.jsx';
import MobileTabBar from './components/MobileTabBar.jsx';
import TopBar from './components/TopBar.jsx';
import ScanStatusIndicator from './components/ScanStatusIndicator.jsx';
import DashboardView from './components/DashboardView.jsx';
import ClippersView from './components/ClippersView.jsx';
import ViewsClicksToggle from './components/ViewsClicksToggle.jsx';
import ClipperView from './components/ClipperView.jsx';
import LeaderboardView from './components/LeaderboardView.jsx';
import DailyView from './components/DailyView.jsx';
import ManagementView from './components/ManagementView.jsx';
import SettingsView from './components/SettingsView.jsx';
import AccountDrawer from './components/AccountDrawer.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import DashboardSkeleton from './components/DashboardSkeleton.jsx';
import WelcomeScreen from './components/WelcomeScreen.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import Toast from './components/Toast.jsx';

const SCAN_POLL_MS = 4000;
const MIN_LOADING_MS = 1500; // durée minimale du loader initial (voir LoadingScreen.jsx)

// Comptes par e-mail (voir auth.js), pas d'organisation/rôles (voir
// backup/dashboard-rewrite-27-08 pour cette version-là, qui a besoin de
// Postgres) : un seul bot, mais plusieurs personnes peuvent avoir leur
// propre compte pour s'y connecter.
export default function App() {
  // Vérifié une fois au montage : passwordSet distingue le tout premier
  // accès (aucun mot de passe encore créé, voir auth.js#isPasswordSet) de
  // la reconnexion normale — même écran (LoginScreen), juste le mode qui
  // change (voir LoginScreen.jsx).
  const [authChecked, setAuthChecked] = useState(false);
  const [passwordSet, setPasswordSet] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [currentEmail, setCurrentEmail] = useState(null);
  // Profil de la session (admin, manager ou clipper) et, pour un clipper, son
  // compte suivi — renvoyés par /api/me. Les droits réels sont contrôlés par
  // le serveur ; ils ne servent ici qu'à choisir les écrans à afficher.
  const [role, setRole] = useState(null);
  const [ownAccount, setOwnAccount] = useState(null);
  const isAdmin = role === 'admin';
  const canSeeAll = role === 'admin' || role === 'manager';

  // Écran de bienvenue affiché une fois par onglet (pas à chaque
  // rechargement/reconnexion dans la même session navigateur) avant
  // l'écran de connexion — voir WelcomeScreen.jsx.
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return sessionStorage.getItem('vt-welcome-seen') !== '1'; } catch { return true; }
  });
  const [welcomeExiting, setWelcomeExiting] = useState(false);
  const dismissWelcome = () => {
    setWelcomeExiting(true);
    try { sessionStorage.setItem('vt-welcome-seen', '1'); } catch { /* non bloquant */ }
    // Laisse l'animation de sortie (welcomeOut, 0.35s) se jouer avant de
    // démonter l'écran — sinon le login apparaît en même temps qu'il
    // disparaît plutôt qu'après.
    setTimeout(() => setShowWelcome(false), 340);
  };

  useEffect(() => {
    api.me().then((res) => {
      setPasswordSet(res.passwordSet);
      setAuthenticated(res.authenticated);
      setCurrentEmail(res.email);
      setRole(res.role);
      setOwnAccount(res.account);
      setAuthChecked(true);
    });
  }, []);

  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('dashboard');
  // Toggle Vues/Clics du Dashboard : mémorisé dans le navigateur (simple
  // confort par visiteur — sans localStorage, on retombe sur « Vues »).
  const [dashboardMode, setDashboardMode] = useState(() => {
    try {
      return localStorage.getItem('viewtracker.dashboardMode') === 'clicks' ? 'clicks' : 'views';
    } catch {
      return 'views';
    }
  });
  const changeDashboardMode = (mode) => {
    setDashboardMode(mode);
    try {
      localStorage.setItem('viewtracker.dashboardMode', mode);
    } catch {
      // stockage indisponible (navigation privée...) : le mode reste valable pour la session
    }
  };
  const [selectedClipper, setSelectedClipper] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [scan, setScan] = useState({ scanning: false, lastScanAt: null });
  const [settings, setSettings] = useState({ notifDaily: true, notifWarnings: true });
  const [drawerAccountName, setDrawerAccountName] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef(null);
  const pollTimer = useRef(null);
  const wasScanning = useRef(false);

  const showToast = (msg) => {
    clearTimeout(toastTimer.current);
    setToastMessage(msg);
    toastTimer.current = setTimeout(() => setToastMessage(''), 2600);
  };

  // Session expirée/coupée pendant l'usage (onglet resté ouvert 30 jours,
  // cookie effacé...) : renvoie à l'écran de connexion plutôt que de
  // laisser les appels API échouer silencieusement en boucle.
  const handleApiError = (err) => {
    if (err?.status === 401) {
      setAuthenticated(false);
      setLoaded(false);
      return true;
    }
    return false;
  };

  const loadDashboard = () => {
    api.getDashboard().then((data) => {
      setKpis(data.kpis);
      setAccounts(data.accounts);
      setScan(data.scan);
    }).catch(handleApiError);
  };

  useEffect(() => {
    if (!authenticated || !role) return;
    const start = Date.now();
    // Le clipper n'a rien à charger ici (sa page se charge seule) ; le manager
    // n'a pas accès aux réglages ; l'admin charge tout.
    Promise.all([
      canSeeAll ? api.getDashboard() : Promise.resolve(null),
      isAdmin ? api.getSettings() : Promise.resolve(null)
    ]).then(([dash, s]) => {
      // Délai minimum avant de masquer le loader (voir LoadingScreen.jsx) :
      // sans lui, l'animation ne fait qu'un flash imperceptible dès que les
      // données viennent de fichiers JSON locaux plutôt que d'une vraie
      // requête réseau — repris tel quel de l'ancien MIN_LOADING_MS.
      const remaining = Math.max(0, MIN_LOADING_MS - (Date.now() - start));
      setTimeout(() => {
        if (dash) {
          setKpis(dash.kpis);
          setAccounts(dash.accounts);
          setScan(dash.scan);
        }
        if (s) setSettings(s);
        setLoaded(true);
      }, remaining);
    }).catch(handleApiError);
  }, [authenticated, role]);

  // Pas de déclenchement de scan depuis le dashboard : la collecte reste
  // pilotée uniquement par le cron planifié (voir src/index.js) ou les
  // scripts CLI (npm run scan / run-once). On interroge périodiquement le
  // statut pour refléter les collectes en cours côté serveur.
  useEffect(() => {
    if (!loaded || !canSeeAll) return;
    pollTimer.current = setInterval(() => {
      api.getScanStatus().then((status) => {
        setScan(status);
        if (wasScanning.current && !status.scanning) {
          showToast(status.lastScanError ? `Collecte terminée avec erreur : ${status.lastScanError}` : 'Collecte terminée — classement mis à jour');
          loadDashboard();
        }
        wasScanning.current = status.scanning;
      }).catch(handleApiError);
    }, SCAN_POLL_MS);
    return () => clearInterval(pollTimer.current);
  }, [loaded, canSeeAll]);

  const handleUpdateSettings = async (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    try {
      const updated = await api.updateSettings(patch);
      setSettings(updated);
      return updated;
    } catch (e) {
      if (!handleApiError(e)) showToast(`Erreur : ${e.message}`);
      throw e;
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    setAuthenticated(false);
    setCurrentEmail(null);
    setRole(null);
    setOwnAccount(null);
    setView('dashboard');
    setLoaded(false);
  };

  const handleLoginSuccess = () => {
    setAuthenticated(true);
    api.me().then((res) => { setCurrentEmail(res.email); setRole(res.role); setOwnAccount(res.account); }).catch(() => {});
  };

  if (!authChecked) return <LoadingScreen />;
  if (!authenticated && showWelcome) return <WelcomeScreen exiting={welcomeExiting} onContinue={dismissWelcome} />;
  if (!authenticated) return <LoginScreen setupMode={!passwordSet} onSuccess={handleLoginSuccess} />;

  const drawerAccount = accounts.find((a) => a.name === drawerAccountName) || null;

  // Écran d'attente tant que le profil n'est pas connu (juste après la connexion).
  if (!role) return <LoadingScreen />;

  // « Tous les clippers » : ouvre la page d'un clipper (admin et manager).
  const openClipper = (name) => { setSelectedClipper(name); setView('dashboard'); setDashboardMode('clicks'); };
  const roleLabel = { admin: 'admin', manager: 'manager', clipper: 'clipper' }[role];

  // Titre de l'écran Dashboard selon le profil et le mode (mêmes intitulés que
  // l'app de référence : « Dashboard admin » / « Dashboard manager » / clipper).
  let topMeta = null;
  if (view === 'dashboard') {
    if (role === 'clipper') topMeta = [ownAccount || 'Mon compte', '', 'Dashboard clipper'];
    else if (selectedClipper) topMeta = [selectedClipper, '', 'Dashboard clipper'];
    else if (dashboardMode === 'clicks') topMeta = ['Tous les clippers', '', `Dashboard ${roleLabel}`];
  }
  if (view === 'settings' && !isAdmin) topMeta = ['Compte', 'Mot de passe et déconnexion'];

  return (
    <div className="app">
      <Sidebar
        role={role}
        view={view}
        onNavigate={(next) => { setSelectedClipper(null); setView(next); }}
        onLogout={handleLogout}
      />
      {/* Barre d'onglets du bas — même destinations que Sidebar, visible
          uniquement sous 700px (voir .mobile-tabbar dans theme.css), les
          deux navs restant montées en permanence plutôt que démontées/
          remontées au resize. */}
      <MobileTabBar role={role} view={view} onNavigate={(next) => { setSelectedClipper(null); setView(next); }} />
      <div className="main">
        <TopBar
          view={view}
          meta={topMeta}
          actions={view === 'dashboard' && canSeeAll ? (
            <>
              <ViewsClicksToggle mode={dashboardMode} onChange={(mode) => { setSelectedClipper(null); changeDashboardMode(mode); }} />
              {dashboardMode === 'views' && !selectedClipper && <ScanStatusIndicator scan={scan} />}
            </>
          ) : null}
        />

        {/* Dashboard d'un clipper : uniquement son propre compte. */}
        {view === 'dashboard' && role === 'clipper' && <ClipperView account={null} onToast={showToast} />}

        {/* Admin et manager : page d'un clipper (depuis « Tous les clippers »), sinon Vues ou Clics. */}
        {view === 'dashboard' && canSeeAll && selectedClipper && (
          <ClipperView account={selectedClipper} onBack={() => setSelectedClipper(null)} onToast={showToast} />
        )}
        {view === 'dashboard' && canSeeAll && !selectedClipper && dashboardMode === 'clicks' && (
          <ClippersView role={role} onOpenClipper={openClipper} onOpenManagement={isAdmin ? () => setView('management') : null} onToast={showToast} />
        )}
        {view === 'dashboard' && canSeeAll && !selectedClipper && dashboardMode === 'views' && (
          loaded && kpis ? (
            <DashboardView
              kpis={kpis}
              accounts={accounts}
              readOnly={!isAdmin}
              onOpenDrawer={setDrawerAccountName}
              onAccountsChanged={setAccounts}
              onToast={showToast}
            />
          ) : (
            <DashboardSkeleton />
          )
        )}

        {view === 'leaderboard' && <LeaderboardView role={role} account={ownAccount} onToast={showToast} />}
        {view === 'daily' && canSeeAll && <DailyView onOpenClipper={openClipper} onToast={showToast} />}
        {view === 'management' && isAdmin && (
          loaded ? (
            <ManagementView
              accounts={accounts}
              defaultRatePer1000={+((settings.commissionPerClick ?? 0.18) * 1000).toFixed(4)}
              currentEmail={currentEmail}
              onAccountsChanged={setAccounts}
              onToast={showToast}
            />
          ) : <DashboardSkeleton />
        )}
        {view === 'settings' && (
          <SettingsView
            role={role}
            settings={settings}
            onToggle={(key, value) => handleUpdateSettings({ [key]: value })}
            onUpdateSettings={handleUpdateSettings}
            onToast={showToast}
            onLogout={handleLogout}
          />
        )}
      </div>

      <Toast message={toastMessage} />
      {canSeeAll && (
        <AccountDrawer
          account={drawerAccount}
          readOnly={!isAdmin}
          onClose={() => setDrawerAccountName(null)}
          onAccountsChanged={setAccounts}
          onToast={showToast}
        />
      )}
    </div>
  );
}
