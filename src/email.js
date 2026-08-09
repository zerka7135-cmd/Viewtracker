import { config } from './config.js';

// Envoi d'email via l'API REST de Resend (https://resend.com) — appel
// fetch direct plutôt que le SDK npm `resend`, pour ne pas ajouter de
// dépendance pour un seul appel HTTP (même logique que src/passwords.js
// pour crypto.scrypt plutôt que bcrypt).
//
// RESEND_API_KEY est nécessaire pour que l'envoi fonctionne réellement —
// voir README, section Auth. Sans clé, on log une erreur côté serveur
// plutôt que de faire planter le flow (le mot de passe oublié doit rester
// silencieux côté client, voir src/auth.js#requestPasswordReset).
export async function sendEmail({ to, subject, html }) {
  if (!config.resendApiKey) {
    throw new Error('RESEND_API_KEY manquant — impossible d\'envoyer l\'email (voir README, section Auth)');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: config.resendFrom, to, subject, html })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend a répondu ${res.status} : ${body}`);
  }
}
