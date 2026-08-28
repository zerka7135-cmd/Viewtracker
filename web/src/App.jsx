import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import ScanStatusIndicator from './components/ScanStatusIndicator.jsx';
import DashboardView from './components/DashboardView.jsx';
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('vt-sidebar-collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('vt-sidebar-collapsed', sidebarCollapsed ? '1' : '0'); } catch { /* non bloquant */ }
  }, [sidebarCollapsed]);

  // Vérifié une fois au montage : passwordSet distingue le tout premier
  // accès (aucun mot de passe encore créé, voir auth.js#isPasswordSet) de
  // la reconnexion normale — même écran (LoginScreen), juste le mode qui
  // change (voir LoginScreen.jsx).
  const [authChecked, setAuthChecked] = useState(false);
  const [passwordSet, setPasswordSet] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [currentEmail, setCurrentEmail] = useState(null);

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
      setAuthChecked(true);
    });
  }, []);

  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('dashboard');
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
    if (!authenticated) return;
    const start = Date.now();
    Promise.all([api.getDashboard(), api.getSettings()]).then(([dash, s]) => {
      // Délai minimum avant de masquer le loader (voir LoadingScreen.jsx) :
      // sans lui, l'animation ne fait qu'un flash imperceptible dès que les
      // données viennent de fichiers JSON locaux plutôt que d'une vraie
      // requête réseau — repris tel quel de l'ancien MIN_LOADING_MS.
      const remaining = Math.max(0, MIN_LOADING_MS - (Date.now() - start));
      setTimeout(() => {
        setKpis(dash.kpis);
        setAccounts(dash.accounts);
        setScan(dash.scan);
        setSettings(s);
        setLoaded(true);
      }, remaining);
    }).catch(handleApiError);
  }, [authenticated]);

  // Pas de déclenchement de scan depuis le dashboard : la collecte reste
  // pilotée uniquement par le cron planifié (voir src/index.js) ou les
  // scripts CLI (npm run scan / run-once). On interroge périodiquement le
  // statut pour refléter les collectes en cours côté serveur.
  useEffect(() => {
    if (!loaded) return;
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
  }, [loaded]);

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
    setLoaded(false);
  };

  const handleLoginSuccess = () => {
    setAuthenticated(true);
    api.me().then((res) => setCurrentEmail(res.email)).catch(() => {});
  };

  if (!authChecked) return <LoadingScreen />;
  if (!authenticated && showWelcome) return <WelcomeScreen exiting={welcomeExiting} onContinue={dismissWelcome} />;
  if (!authenticated) return <LoginScreen setupMode={!passwordSet} onSuccess={handleLoginSuccess} />;

  const drawerAccount = accounts.find((a) => a.name === drawerAccountName) || null;

  return (
    <div className="app">
      <Sidebar
        view={view}
        onNavigate={setView}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        onLogout={handleLogout}
      />
      <div className="main">
        <TopBar
          view={view}
          actions={view === 'dashboard' ? (
            <div className="topbar-actions">
              <ScanStatusIndicator scan={scan} />
            </div>
          ) : null}
        />

        {view === 'dashboard' && (
          loaded && kpis ? (
            <DashboardView
              kpis={kpis}
              accounts={accounts}
              onOpenDrawer={setDrawerAccountName}
              onAccountsChanged={setAccounts}
              onToast={showToast}
            />
          ) : (
            <DashboardSkeleton />
          )
        )}
        {view === 'settings' && (
          <SettingsView
            settings={settings}
            onToggle={(key, value) => handleUpdateSettings({ [key]: value })}
            onUpdateSettings={handleUpdateSettings}
            onToast={showToast}
            currentEmail={currentEmail}
          />
        )}
      </div>

      <Toast message={toastMessage} />
      <AccountDrawer
        account={drawerAccount}
        onClose={() => setDrawerAccountName(null)}
        onAccountsChanged={setAccounts}
        onToast={showToast}
      />
    </div>
  );
}
