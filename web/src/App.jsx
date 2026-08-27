import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import ScanStatusIndicator from './components/ScanStatusIndicator.jsx';
import DashboardView from './components/DashboardView.jsx';
import SettingsView from './components/SettingsView.jsx';
import AccountDrawer from './components/AccountDrawer.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import Toast from './components/Toast.jsx';
import { getStoredTheme, applyTheme } from './theme.js';

const SCAN_POLL_MS = 4000;
const MIN_LOADING_MS = 1500; // durée minimale du loader initial (voir LoadingScreen.jsx)

// Version sans auth/multi-organisation de l'App d'origine (voir
// backup/dashboard-rewrite-27-08) : un seul bot, un seul jeu de données
// (data/*.json), personne à identifier. Pas de /api/me, pas d'écran de
// connexion — le dashboard s'affiche directement, protégé en amont par
// Railway/le réseau plutôt que par un login applicatif (voir README).
export default function App() {
  const [theme, setTheme] = useState(getStoredTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('vt-sidebar-collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('vt-sidebar-collapsed', sidebarCollapsed ? '1' : '0'); } catch { /* non bloquant */ }
  }, [sidebarCollapsed]);

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

  const loadDashboard = () => {
    api.getDashboard().then((data) => {
      setKpis(data.kpis);
      setAccounts(data.accounts);
      setScan(data.scan);
    });
  };

  useEffect(() => {
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
    });
  }, []);

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
          showToast(status.lastScanError ? `Scan terminé avec erreur : ${status.lastScanError}` : 'Scan terminé — classement mis à jour');
          loadDashboard();
        }
        wasScanning.current = status.scanning;
      });
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
      showToast(`Erreur : ${e.message}`);
      throw e;
    }
  };

  if (!loaded) return <LoadingScreen />;

  const drawerAccount = accounts.find((a) => a.name === drawerAccountName) || null;

  return (
    <div className="app">
      <Sidebar
        view={view}
        onNavigate={setView}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
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

        {view === 'dashboard' && kpis && (
          <DashboardView
            kpis={kpis}
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
