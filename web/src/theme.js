// Préférence clair/sombre — stockée en local (par navigateur), pas encore
// par organisation/utilisateur côté serveur. Voir Paramètres > Apparence.
const STORAGE_KEY = 'vt-theme';

export function getStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage indisponible (navigation privée stricte, etc.) — la
    // préférence ne survit juste pas au rechargement, pas bloquant.
  }
}
