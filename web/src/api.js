// Petit wrapper fetch vers l'API Express (src/server.js). Comptes par
// e-mail (voir auth.js) — cookie de session inclus (credentials:'include'),
// nécessaire même en dev où Vite tourne sur un port différent d'Express.

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
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

export const me = () => request('/me');
export const setupPassword = (email, password) => request('/setup-password', { method: 'POST', body: JSON.stringify({ email, password }) });
export const login = (email, password) => request('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
export const logout = () => request('/logout', { method: 'POST' });
export const changePassword = (currentPassword, newPassword) => request('/account/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) });

// Comptes autorisés à se connecter (voir auth.js) — n'importe quel compte
// déjà connecté peut en ajouter/retirer d'autres, pas de rôle admin distinct.
export const getUsers = () => request('/users');
export const addUser = (email, password) => request('/users', { method: 'POST', body: JSON.stringify({ email, password }) });
export const removeUser = (email) => request(`/users/${encodeURIComponent(email)}`, { method: 'DELETE' });

export const getDashboard = () => request('/dashboard');
export const addAccount = (name, urls) => request('/accounts', { method: 'POST', body: JSON.stringify({ name, urls }) });
export const updateAccount = (currentName, name, urls) => request(`/accounts/${encodeURIComponent(currentName)}`, { method: 'PATCH', body: JSON.stringify({ name, urls }) });
export const deleteAccount = (name) => request(`/accounts/${encodeURIComponent(name)}`, { method: 'DELETE' });

// `range.days` : nombre de collectes les plus récentes — le filtre "24h"
// demande simplement days=2 (les deux dernières collectes), pas de
// granularité horaire fabriquée (voir DashboardView.jsx#CHART_RANGES).
export const getHistory = (range, platform) => request(`/history?days=${range.days}&platform=${platform}`);
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
