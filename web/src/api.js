// Petit wrapper fetch vers l'API Express (src/server.js) — cookie de
// session inclus (credentials:'include'), nécessaire même en dev où Vite
// tourne sur un port différent d'Express.

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
    // Réponse sans corps JSON (ex. 202 Accepted vide côté certains clients) — ignoré.
  }

  if (!res.ok) {
    throw new ApiError(body?.error || `Erreur ${res.status}`, res.status);
  }
  return body;
}

export { ApiError };

export const login = (email, password) => request('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
export const signup = (email, password) => request('/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
export const forgotPassword = (email) => request('/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
export const resetPassword = (token, password) => request('/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
export const acceptInvitation = (inviteId, password) => request('/invitations/accept', { method: 'POST', body: JSON.stringify({ inviteId, password }) });
export const logout = () => request('/logout', { method: 'POST' });
export const me = () => request('/me');

export const getDashboard = () => request('/dashboard');
export const getAccounts = () => request('/accounts');
export const addAccount = (name, urls, bioLink) => request('/accounts', { method: 'POST', body: JSON.stringify({ name, urls, bioLink }) });
export const updateAccount = (currentName, name, urls, bioLink) => request(`/accounts/${encodeURIComponent(currentName)}`, { method: 'PATCH', body: JSON.stringify({ name, urls, bioLink }) });
export const deleteAccount = (name) => request(`/accounts/${encodeURIComponent(name)}`, { method: 'DELETE' });

// `range` : { days: N } ou { hours: 24 } (filtre "24h", voir DashboardView.jsx) —
// une seule fonction plutôt que deux, pour couvrir les deux granularités
// exposées par GET /api/history (voir server.js).
export const getHistory = (range, platform) => {
  const q = range.hours ? `hours=${range.hours}` : `days=${range.days}`;
  return request(`/history?${q}&platform=${platform}`);
};
export const getAccountHistory = (name, days, platform) => request(`/accounts/${encodeURIComponent(name)}/history?days=${days}&platform=${platform}`);
export const getClicksHistory = (range, platform) => {
  const q = range.hours ? `hours=${range.hours}` : `days=${range.days}`;
  return request(`/clicks/history?${q}&platform=${platform}`);
};

export const getSettings = () => request('/settings');
export const updateSettings = (patch) => request('/settings', { method: 'PATCH', body: JSON.stringify(patch) });

export const completeOnboarding = () => request('/onboarding/complete', { method: 'POST' });

export const changePassword = (currentPassword, newPassword) => request('/account/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) });
export const renameOrganization = (name) => request('/organization', { method: 'PATCH', body: JSON.stringify({ name }) });
export const deleteOrganization = (name) => request('/organization', { method: 'DELETE', body: JSON.stringify({ name }) });

// Token/Client ID/Guild ID du bot Discord (voir botConfig.js) — distincts
// des réglages par organisation (/settings) : ils identifient le bot
// lui-même, persistés dans .env, effet après redémarrage (npm start).
export const getBotConfig = () => request('/bot-config');
export const updateBotConfig = (patch) => request('/bot-config', { method: 'PATCH', body: JSON.stringify(patch) });

// Pas d'UI pour gérer les membres/invitations pour l'instant (retirée —
// faisait doublon avec "Ajouter un compte" aux yeux de l'utilisateur) :
// les routes serveur (GET/POST/DELETE /api/members) restent disponibles
// côté API mais ne sont plus appelées depuis le dashboard.

// Pas de déclenchement de scan depuis le dashboard (voir server.js) —
// uniquement le statut, en lecture seule, pour refléter les collectes du
// cron côté serveur.
export const getScanStatus = () => request('/scan/status');
