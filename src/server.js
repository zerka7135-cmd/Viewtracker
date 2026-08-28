import path from 'path';
import express from 'express';
import { getAccountsWithStats, getKpis, getHistorySeries, getHistorySeriesHourly, getAccountHistorySeries } from './dashboardData.js';
import { addAccount, updateAccount, deleteAccount } from './accountsStore.js';
import { loadSettings, updateSettings } from './settingsStore.js';
import { getBotConfigStatus, updateBotConfig } from './botConfig.js';
import { getScanStatus } from './scanStatus.js';
import {
  isPasswordSet, setInitialPassword, checkPassword, changePassword,
  addUser, removeUser, listEmails, getSessionEmail,
  setSessionCookie, clearSessionCookie, isAuthenticated,
  recordLoginFailure, recordLoginSuccess, loginDelayMs, shouldAlertOwner
} from './auth.js';

const WEB_DIST = path.resolve('./web/dist');

// CSP calibrée pour ce bundle précis (voir web/dist/index.html) : un seul
// <script type="module"> et une seule feuille de style, tous deux servis
// depuis notre propre origine, aucun script inline, aucune ressource
// externe (pas de police/CDN/image tierce — voir web/src/theme.css). Le
// bundle React utilise des styles inline via la prop `style` (donc
// style-src doit accepter 'unsafe-inline' — c'est le seul assouplissement
// nécessaire ici, script-src reste strict).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

// Serveur HTTP du dashboard (API + assets statiques du build React, voir
// web/) — comptes multiples par e-mail (voir auth.js), mais toujours pas
// d'organisation/rôles (voir backup/dashboard-rewrite-27-08 pour cette
// version-là, qui a besoin de Postgres) : un seul bot, un seul jeu de
// données (data/*.json), plusieurs personnes peuvent s'y connecter avec
// leurs propres identifiants mais ont toutes le même accès complet.
//
// Aucune route ne déclenche de scan : la collecte reste uniquement pilotée
// par le cron planifié ou les scripts CLI (npm run scan / run-once) — voir
// src/scanStatus.js. GET /api/scan/status est en lecture seule.
//
// `client` : instance discord.js déjà connectée (voir index.js), utilisée
// uniquement pour envoyer un MP d'alerte à l'owner en cas de tentatives de
// connexion suspectes (voir /api/login ci-dessous) — optionnel, undefined
// dans les scripts qui démarrent le serveur seul (tests locaux).
export async function startServer(client) {
  const app = express();
  app.use(express.json());
  // Nécessaire pour que req.secure/req.ip reflètent le HTTPS/IP réels
  // derrière le proxy Railway (qui termine le TLS et transmet en HTTP en
  // interne) — sinon le cookie de session ne serait jamais marqué `secure`,
  // et req.ip renverrait toujours l'IP interne du proxy plutôt que celle du
  // visiteur (voir rate-limit par IP sur /api/login ci-dessous).
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
    // HSTS seulement sur une requête déjà en HTTPS : l'envoyer en clair sur
    // http:// n'aurait aucun effet (le navigateur l'ignore hors HTTPS) et
    // ça évite de piéger un accès local en http:// pendant le dev.
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // --- Auth (routes publiques, avant le middleware requireAuth ci-dessous) ---

  app.get('/api/me', (req, res) => {
    res.json({ passwordSet: isPasswordSet(), authenticated: isAuthenticated(req), email: getSessionEmail(req) });
  });

  // Uniquement tant qu'aucun compte n'existe — passé ce point,
  // setInitialPassword() refuse (voir auth.js), il faut être déjà connecté
  // et passer par POST /api/users pour ajouter un compte supplémentaire.
  app.post('/api/setup-password', async (req, res, next) => {
    try {
      const email = req.body?.email || '';
      await setInitialPassword(email, req.body?.password || '');
      setSessionCookie(req, res, email.trim().toLowerCase());
      res.status(201).json({ ok: true });
    } catch (error) {
      if (error.message.includes('caractères') || error.message.includes('déjà configuré') || error.message.includes('invalide')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  app.post('/api/login', async (req, res, next) => {
    try {
      const ip = req.ip;
      const email = (req.body?.email || '').trim().toLowerCase();
      const delay = loginDelayMs(ip);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

      const valid = await checkPassword(email, req.body?.password || '');
      if (!valid) {
        recordLoginFailure(ip);
        if (shouldAlertOwner(ip)) sendLoginAlert(client, ip, email).catch(() => {});
        return res.status(401).json({ error: 'E-mail ou mot de passe incorrect' });
      }
      recordLoginSuccess(ip);
      setSessionCookie(req, res, email);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // --- À partir d'ici, tout /api/* exige une session valide. ---
  app.use('/api', (req, res, next) => {
    if (isAuthenticated(req)) return next();
    res.status(401).json({ error: 'Non authentifié' });
  });

  app.patch('/api/account/password', async (req, res, next) => {
    try {
      const email = getSessionEmail(req);
      await changePassword(email, req.body?.currentPassword || '', req.body?.newPassword || '');
      res.json({ ok: true });
    } catch (error) {
      if (error.message.includes('incorrect') || error.message.includes('caractères')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // Comptes autorisés à se connecter au dashboard (voir auth.js) — pas de
  // rôles, n'importe quel compte déjà connecté peut en ajouter/retirer
  // d'autres.
  app.get('/api/users', (req, res) => {
    res.json({ emails: listEmails(), currentEmail: getSessionEmail(req) });
  });

  app.post('/api/users', async (req, res, next) => {
    try {
      await addUser(req.body?.email || '', req.body?.password || '');
      res.status(201).json({ emails: listEmails() });
    } catch (error) {
      if (error.message.includes('caractères') || error.message.includes('déjà utilisée') || error.message.includes('invalide')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  app.delete('/api/users/:email', (req, res, next) => {
    try {
      removeUser(req.params.email);
      res.json({ emails: listEmails() });
    } catch (error) {
      if (error.message.includes('dernier compte') || error.message.includes('introuvable')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  app.get('/api/dashboard', (req, res) => {
    res.json({ kpis: getKpis(), accounts: getAccountsWithStats(), scan: getScanStatus() });
  });

  app.post('/api/accounts', (req, res, next) => {
    try {
      const { name, urls } = req.body || {};
      const trimmed = (name || '').trim();
      if (!trimmed) return res.status(400).json({ error: 'Nom de compte requis' });
      addAccount(trimmed, normalizeUrls(urls));
      res.status(201).json({ accounts: getAccountsWithStats() });
    } catch (error) {
      if (error.message.includes('existe déjà')) return res.status(409).json({ error: error.message });
      next(error);
    }
  });

  app.patch('/api/accounts/:name', (req, res, next) => {
    try {
      const { name, urls } = req.body || {};
      const trimmed = (name || '').trim();
      if (!trimmed) return res.status(400).json({ error: 'Nom de compte requis' });
      updateAccount(req.params.name, trimmed, normalizeUrls(urls));
      res.json({ accounts: getAccountsWithStats() });
    } catch (error) {
      if (error.message.includes('introuvable')) return res.status(404).json({ error: error.message });
      if (error.message.includes('existe déjà')) return res.status(409).json({ error: error.message });
      next(error);
    }
  });

  app.delete('/api/accounts/:name', (req, res, next) => {
    try {
      deleteAccount(req.params.name);
      res.json({ accounts: getAccountsWithStats() });
    } catch (error) {
      if (error.message.includes('introuvable')) return res.status(404).json({ error: error.message });
      next(error);
    }
  });

  // `range` : ?hours=24 (granularité horaire) ou ?days=N (granularité
  // quotidienne) — voir dashboardData.js#getHistorySeries/getHistorySeriesHourly.
  app.get('/api/history', (req, res) => {
    const platform = req.query.platform || 'all';
    const series = req.query.hours
      ? getHistorySeriesHourly(platform)
      : getHistorySeries(Number(req.query.days) || 14, platform);
    res.json({ series });
  });

  app.get('/api/accounts/:name/history', (req, res) => {
    const days = Number(req.query.days) || 14;
    const platform = req.query.platform || 'all';
    res.json({ series: getAccountHistorySeries(req.params.name, days, platform) });
  });

  app.get('/api/settings', (req, res) => {
    res.json(loadSettings());
  });

  app.patch('/api/settings', (req, res) => {
    res.json(updateSettings(req.body || {}));
  });

  // Le token n'est jamais renvoyé en clair (voir botConfig.js) — seulement
  // un aperçu masqué.
  app.get('/api/bot-config', (req, res) => {
    res.json(getBotConfigStatus());
  });

  app.patch('/api/bot-config', (req, res) => {
    res.json(updateBotConfig(req.body || {}));
  });

  app.get('/api/scan/status', (req, res) => {
    res.json(getScanStatus());
  });

  // Assets statiques du build React (voir `npm run build:web`) — publics
  // (l'écran de connexion vit dans ce même bundle) : ce sont les routes
  // /api/* ci-dessus qui portent la protection, pas le HTML/JS/CSS lui-même.
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    console.error('Erreur serveur dashboard :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Dashboard disponible sur le port ${port}`);
  });
}

function normalizeUrls(urls) {
  const arr = Array.isArray(urls) ? urls : [];
  return [0, 1, 2].map(i => (arr[i] || '').trim());
}

// MP à l'owner dès qu'une IP dépasse le seuil d'échecs de connexion
// consécutifs (voir auth.js#shouldAlertOwner) — visibilité minimale sur une
// tentative de bruteforce en cours, sans bloquer personne. N'échoue jamais
// bruyamment : un souci d'envoi ne doit pas casser la réponse HTTP du login
// (voir l'appel .catch(() => {}) ci-dessus).
async function sendLoginAlert(client, ip, attemptedEmail) {
  if (!client) return;
  const { discordOwnerId } = loadSettings();
  if (!discordOwnerId) return;
  try {
    const owner = await client.users.fetch(discordOwnerId);
    await owner.send(`🔐 Plusieurs tentatives de connexion échouées au dashboard depuis l'IP \`${ip}\` (dernier e-mail essayé : \`${attemptedEmail || 'inconnu'}\`). Si ce n'est pas toi, le mot de passe tient toujours (juste ralenti), mais surveille.`);
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'alerte de connexion :', error);
  }
}
