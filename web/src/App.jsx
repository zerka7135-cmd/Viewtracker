import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import ModeToggle from './components/ModeToggle.jsx';
import ScanStatusIndicator from './components/ScanStatusIndicator.jsx';
import DashboardView from './components/DashboardView.jsx';
import AccountsView from './components/AccountsView.jsx';
import SettingsView from './components/SettingsView.jsx';
import AccountDrawer from './components/AccountDrawer.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import OnboardingScreen from './components/OnboardingScreen.jsx';
import ResetPasswordScreen from './components/ResetPasswordScreen.jsx';
import AcceptInvitationScreen from './components/AcceptInvitationScreen.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import Toast from './components/Toast.jsx';
import { getStoredTheme, applyTheme } from './theme.js';

const SCAN_POLL_MS = 4000;
const MIN_LOADING_MS = 5000; // durée minimale du loader initial (voir LoadingScreen.jsx), même si /api/me répond plus vite

export default function App() {
  // Liens reçus par email (reset de mot de passe / invitation, voir
  // auth.js) : prioritaires sur tout le reste, quel que soit l'état de
  // connexion actuel.
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('resetToken'));
  const [inviteId] = useState(() => new URLSearchParams(window.location.search).get('inviteId'));

  // Clair/sombre (voir Paramètres > Apparence) — appliqué avant même le
  // login, pour que l'écran de connexion respecte déjà la préférence.
  const [theme, setTheme] = useState(getStoredTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);

  // Sidebar repliée/dépliée — préférence locale au navigateur, comme le
  // thème (voir Sidebar.jsx, bascule sur la même ligne que le logo).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('vt-sidebar-collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('vt-sidebar-collapsed', sidebarCollapsed ? '1' : '0'); } catch { /* non bloquant */ }
  }, [sidebarCollapsed]);

  const [authChecked, setAuthChecked] = useState(false);
  const [session, setSession] = useState(null); // { email, orgName, role, onboardingCompleted } | null
  const authenticated = session !== null;
  const needsOnboarding = authenticated && !session.onboardingCompleted;

  const [view, setView] = useState('dashboard');
  // Bascule Vues/Clics du Dashboard (voir ModeToggle.jsx) — vit ici plutôt
  // que dans DashboardView pour pouvoir être affichée dans TopBar, sur la
  // même ligne que le titre "Dashboard".
  const [dashboardMode, setDashboardMode] = useState('views');
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

  const loadDashboard = () => {
    api.getDashboard().then((data) => {
      setKpis(data.kpis);
      setAccounts(data.accounts);
      setScan(data.scan);
    });
  };

  useEffect(() => {
    const start = Date.now();
    api.me().then((res) => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
      setTimeout(() => {
        setSession(res.authenticated
          ? { email: res.email, orgName: res.orgName, role: res.role, onboardingCompleted: res.onboardingCompleted }
          : null);
        setAuthChecked(true);
      }, remaining);
    });
  }, []);

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    setSession(null);
  };

  // Le cookie de session est déjà effacé côté serveur (voir DELETE
  // /api/organization) puisque l'organisation de l'utilisateur n'existe
  // plus — il ne reste qu'à réinitialiser l'état local, comme un logout
  // (pas de toast : on bascule directement sur l'écran de login).
  const handleOrgDeleted = () => {
    setSession(null);
  };

  const handleOnboardingDone = async () => {
    await api.completeOnboarding();
    setSession((s) => ({ ...s, onboardingCompleted: true }));
  };

  useEffect(() => {
    if (!authenticated || needsOnboarding) return;
    loadDashboard();
    api.getSettings().then(setSettings);
  }, [authenticated, needsOnboarding]);

  // Pas de déclenchement de scan depuis le dashboard : la collecte reste
  // pilotée uniquement par le cron planifié côté serveur (voir
  // src/index.js). On interroge périodiquement le statut pour refléter
  // les collectes du cron (heure de dernier scan, toast à la fin).
  useEffect(() => {
    if (!authenticated || needsOnboarding) return;
    pollTimer.current = setInterval(() => {
      api.getScanStatus().then((status) => {
        setScan(status);
        if (wasScanning.current && !status.scanning) {
          showToast(status.lastScanError ? `Scan terminé avec erreur : ${status.lastScanError}` : 'Scan terminé — classement mis à jour');
          loadDashboard();
        }
        wasScanning.current = status.scanning;
      });
    }, SCAN_POLL_MS);
    return () => clearInterval(pollTimer.current);
  }, [authenticated]);

  // Utilisé à la fois par les toggles (patch = {une clé}) et par le
  // formulaire "Diffusion Discord & collecte" (patch = plusieurs clés à
  // la fois) — voir SettingsView.jsx.
  const handleUpdateSettings = async (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    try {
      const updated = await api.updateSettings(patch);
      setSettings(updated);
      return updated;
    } catch (e) {
      showToast(`Erreur : ${e.message}`);
      throw e;
    }
  };

  if (resetToken) {
    return <ResetPasswordScreen token={resetToken} onDone={() => window.location.replace(window.location.pathname)} />;
  }
  if (inviteId) {
    return <AcceptInvitationScreen inviteId={inviteId} onDone={() => window.location.replace(window.location.pathname)} />;
  }

  if (!authChecked) return <LoadingScreen />;
  if (!authenticated) return <LoginScreen onSuccess={setSession} />;
  if (needsOnboarding) return <OnboardingScreen onDone={handleOnboardingDone} />;

  const drawerAccount = accounts.find((a) => a.name === drawerAccountName) || null;

  return (
    <div className="app">
      <Sidebar
        view={view}
        onNavigate={setView}
        session={session}
        onLogout={handleLogout}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />
      <div className="main">
        <TopBar
          view={view}
          actions={view === 'dashboard' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <ScanStatusIndicator scan={scan} />
              <ModeToggle mode={dashboardMode} onChange={setDashboardMode} />
            </div>
          ) : null}
        />

        {view === 'dashboard' && kpis && (
          <DashboardView
            kpis={kpis}
            accounts={accounts}
            mode={dashboardMode}
            onOpenDrawer={setDrawerAccountName}
            onToast={showToast}
          />
        )}
        {view === 'accounts' && (
          <AccountsView
            accounts={accounts}
            onOpenDrawer={setDrawerAccountName}
            onAccountsChanged={setAccounts}
            onToast={showToast}
          />
        )}
        {view === 'settings' && (
          <SettingsView
            settings={settings}
            onToggle={(key, value) => handleUpdateSettings({ [key]: value })}
            onUpdateSettings={handleUpdateSettings}
            session={session}
            onOrgRenamed={(orgName) => setSession((s) => ({ ...s, orgName }))}
            onOrgDeleted={handleOrgDeleted}
            onToast={showToast}
            theme={theme}
            onThemeChange={setTheme}
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
