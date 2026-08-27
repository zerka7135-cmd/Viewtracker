// Petit wrapper fetch vers l'API Express (src/server.js). Version sans
// auth/multi-organisation (voir backup/dashboard-rewrite-27-08 pour la
// version complète) — pas de cookie de session à transmettre.

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // Réponse sans corps JSON (ex. 204) — ignoré.
  }

  if (!res.ok) {
    throw new ApiError(body?.error || `Erreur ${res.status}`, res.status);
  }
  return body;
}

export { ApiError };

export const getDashboard = () => request('/dashboard');
export const addAccount = (name, urls) => request('/accounts', { method: 'POST', body: JSON.stringify({ name, urls }) });
export const updateAccount = (currentName, name, urls) => request(`/accounts/${encodeURIComponent(currentName)}`, { method: 'PATCH', body: JSON.stringify({ name, urls }) });
export const deleteAccount = (name) => request(`/accounts/${encodeURIComponent(name)}`, { method: 'DELETE' });

// `range` : { days: N } ou { hours: 24 } (filtre "24h", voir DashboardView.jsx).
export const getHistory = (range, platform) => {
  const q = range.hours ? `hours=${range.hours}` : `days=${range.days}`;
  return request(`/history?${q}&platform=${platform}`);
};
export const getAccountHistory = (name, days, platform) => request(`/accounts/${encodeURIComponent(name)}/history?days=${days}&platform=${platform}`);

export const getSettings = () => request('/settings');
export const updateSettings = (patch) => request('/settings', { method: 'PATCH', body: JSON.stringify(patch) });

// Token/Client ID/Guild ID du bot Discord (voir botConfig.js) — distincts
// des réglages ci-dessus : ils identifient le bot lui-même et prennent le
// dessus sur les variables d'environnement (Railway ou .env), effet après
// redémarrage du bot (npm start). Le token n'est jamais renvoyé en clair.
export const getBotConfig = () => request('/bot-config');
export const updateBotConfig = (patch) => request('/bot-config', { method: 'PATCH', body: JSON.stringify(patch) });

// Pas de déclenchement de scan depuis le dashboard (voir server.js) —
// uniquement le statut, en lecture seule, pour refléter les collectes du
// cron/des scripts CLI (npm run scan / run-once).
export const getScanStatus = () => request('/scan/status');
