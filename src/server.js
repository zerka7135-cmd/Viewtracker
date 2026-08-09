import path from 'path';
import fs from 'fs';
import express from 'express';
import { config } from './config.js';
import {
  authenticateUser, signupUser, completeOnboarding,
  requestPasswordReset, resetPassword, changePassword,
  listMembers, inviteMember, acceptInvitation, removeMember,
  setSessionCookie, clearSessionCookie, getSessionInfo, requireAuth, requireRole
} from './auth.js';
import { renameOrganization, deleteOrganization } from './org.js';
import { getBotConfigStatus, updateBotConfig } from './botConfig.js';
import { setBioLinkUrl, recordClickAndGetTarget, getClicksHistorySeries, getClicksHistorySeriesHourly } from './bioLink.js';
import { getAccountsWithStats, getKpis, getHistorySeries, getHistorySeriesHourly, getAccountHistorySeries } from './dashboardData.js';
import { addAccount, deleteAccount, updateAccount } from './accountsStore.js';
import { loadSettings, updateSettings } from './settingsStore.js';
import { getScanStatus } from './scanCycle.js';
import { rescheduleIfDefaultOrg } from './scheduler.js';

const WEB_DIST = path.resolve('./web/dist');

/**
 * Démarre le serveur HTTP du dashboard (API + assets statiques du build
 * React, voir web/). Appelé depuis src/index.js indépendamment de l'état
 * du client Discord — le dashboard reste consultable même si le bot est en
 * cours de reconnexion. Aucune route ne déclenche de scan : la collecte
 * reste uniquement pilotée par le cron planifié (voir src/scheduler.js) —
 * `GET /api/scan/status` est en lecture seule, pour refléter ces collectes.
 *
 * `orgId` n'est plus résolu une fois au démarrage : chaque route protégée
 * lit `req.orgId`/`req.role`, posés par le middleware `requireAuth` (voir
 * src/auth.js) à partir de la session de l'utilisateur connecté — un
 * utilisateur ne voit que l'organisation de son membership (une seule pour
 * l'instant, voir plan).
 */
export async function startServer() {
  const app = express();
  app.use(express.json());

  // --- Auth ---
  app.post('/api/login', async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      const session = await authenticateUser(email, password);
      if (!session) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect, ou compte sans organisation.' });
      }
      setSessionCookie(res, session);
      res.json({ ok: true, email: session.email, orgName: session.orgName, role: session.role, onboardingCompleted: session.onboardingCompleted });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/signup', async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      const session = await signupUser(email, password);
      setSessionCookie(res, session);
      res.status(201).json({ ok: true, email: session.email, orgName: session.orgName, role: session.role, onboardingCompleted: session.onboardingCompleted });
    } catch (error) {
      if (error.message.includes('email') || error.message.includes('caractères')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // Toujours une réponse générique, que l'email existe ou non (voir
  // auth.js#requestPasswordReset) — évite de révéler quels emails ont un
  // compte.
  app.post('/api/forgot-password', async (req, res, next) => {
    try {
      await requestPasswordReset(req.body?.email);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/reset-password', async (req, res, next) => {
    try {
      const { token, password } = req.body || {};
      if (!token) return res.status(400).json({ error: 'Lien de réinitialisation invalide' });
      await resetPassword(token, password);
      res.json({ ok: true });
    } catch (error) {
      if (error.message.includes('invalide') || error.message.includes('caractères')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // Publique (pas de session à ce stade — l'invité n'a pas encore de
  // compte, voir auth.js#acceptInvitation).
  app.post('/api/invitations/accept', async (req, res, next) => {
    try {
      const { inviteId, password } = req.body || {};
      if (!inviteId) return res.status(400).json({ error: 'Invitation invalide' });
      const session = await acceptInvitation(inviteId, password);
      setSessionCookie(res, session);
      res.status(201).json({ ok: true, email: session.email, orgName: session.orgName, role: session.role, onboardingCompleted: session.onboardingCompleted });
    } catch (error) {
      if (error.message.includes('invalide') || error.message.includes('caractères') || error.message.includes('existe déjà')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  app.post('/api/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    const session = getSessionInfo(req);
    if (!session) return res.json({ authenticated: false });
    res.json({
      authenticated: true,
      email: session.email,
      orgName: session.orgName,
      role: session.role,
      onboardingCompleted: session.onboardingCompleted
    });
  });

  // --- Routes protégées ---
  const api = express.Router();
  api.use(requireAuth);

  api.get('/dashboard', async (req, res, next) => {
    try {
      const [kpis, accounts] = await Promise.all([getKpis(req.orgId), getAccountsWithStats(req.orgId)]);
      res.json({ kpis, accounts, scan: getScanStatus() });
    } catch (error) {
      next(error);
    }
  });

  api.get('/accounts', async (req, res, next) => {
    try {
      res.json({ accounts: await getAccountsWithStats(req.orgId) });
    } catch (error) {
      next(error);
    }
  });

  api.post('/accounts', async (req, res, next) => {
    try {
      const { name, urls, bioLink } = req.body || {};
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Nom de compte manquant' });
      }
      const trimmedName = name.trim();
      await addAccount(req.orgId, trimmedName, Array.isArray(urls) ? urls : []);
      if (typeof bioLink === 'string') await setBioLinkUrl(req.orgId, trimmedName, bioLink);
      res.status(201).json({ accounts: await getAccountsWithStats(req.orgId) });
    } catch (error) {
      next(error);
    }
  });

  api.patch('/accounts/:name', async (req, res, next) => {
    try {
      const { name: newName, urls, bioLink } = req.body || {};
      const finalName = (newName || req.params.name).trim();
      await updateAccount(req.orgId, req.params.name, finalName, Array.isArray(urls) ? urls : []);
      if (typeof bioLink === 'string') await setBioLinkUrl(req.orgId, finalName, bioLink);
      res.json({ accounts: await getAccountsWithStats(req.orgId) });
    } catch (error) {
      if (error.message.includes('introuvable')) return res.status(404).json({ error: error.message });
      next(error);
    }
  });

  api.delete('/accounts/:name', async (req, res, next) => {
    try {
      await deleteAccount(req.orgId, req.params.name);
      res.json({ accounts: await getAccountsWithStats(req.orgId) });
    } catch (error) {
      next(error);
    }
  });

  api.get('/history', async (req, res, next) => {
    try {
      const platform = ['ig', 'tt', 'yt'].includes(req.query.platform) ? req.query.platform : 'all';
      if (req.query.hours) {
        return res.json({ series: await getHistorySeriesHourly(req.orgId, platform) });
      }
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
      res.json({ series: await getHistorySeries(req.orgId, days, platform) });
    } catch (error) {
      next(error);
    }
  });

  // Historique d'un seul compte suivi — alimente le graphique du tiroir
  // de détail (AccountDrawer.jsx), même logique que /history mais
  // filtrée sur un compte plutôt qu'agrégée sur toute l'organisation.
  api.get('/accounts/:name/history', async (req, res, next) => {
    try {
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
      const platform = ['ig', 'tt', 'yt'].includes(req.query.platform) ? req.query.platform : 'all';
      res.json({ series: await getAccountHistorySeries(req.orgId, req.params.name, days, platform) });
    } catch (error) {
      next(error);
    }
  });

  // Évolution des clics sur les liens en bio (voir bioLink.js) — alimente
  // le graphique "Clics totaux" du Dashboard en mode Clics.
  api.get('/clicks/history', async (req, res, next) => {
    try {
      const platform = ['ig', 'tt', 'yt'].includes(req.query.platform) ? req.query.platform : 'all';
      if (req.query.hours) {
        return res.json({ series: await getClicksHistorySeriesHourly(req.orgId, platform) });
      }
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
      res.json({ series: await getClicksHistorySeries(req.orgId, days, platform) });
    } catch (error) {
      next(error);
    }
  });

  api.get('/settings', async (req, res, next) => {
    try {
      res.json(await loadSettings(req.orgId));
    } catch (error) {
      next(error);
    }
  });

  api.patch('/settings', async (req, res, next) => {
    try {
      const { notifDaily, notifWarnings, discordChannelId, discordOwnerId, cronSchedule, timezone, postsLimit } = req.body || {};
      const patch = {};
      if (typeof notifDaily === 'boolean') patch.notifDaily = notifDaily;
      if (typeof notifWarnings === 'boolean') patch.notifWarnings = notifWarnings;
      if (typeof discordChannelId === 'string') patch.discordChannelId = discordChannelId.trim() || null;
      if (typeof discordOwnerId === 'string') patch.discordOwnerId = discordOwnerId.trim() || null;
      if (typeof cronSchedule === 'string' && cronSchedule.trim()) patch.cronSchedule = cronSchedule.trim();
      if (typeof timezone === 'string' && timezone.trim()) patch.timezone = timezone.trim();
      if (typeof postsLimit === 'number' && postsLimit > 0) patch.postsLimit = Math.floor(postsLimit);

      const updated = await updateSettings(req.orgId, patch);

      // Reprogramme le cron si l'heure/le fuseau ont changé — no-op pour
      // toute organisation autre que celle par défaut (voir scheduler.js).
      if (patch.cronSchedule || patch.timezone) {
        await rescheduleIfDefaultOrg(req.orgId);
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  api.get('/scan/status', (req, res) => {
    res.json(getScanStatus());
  });

  // Marque l'onboarding terminé (voir OnboardingScreen.jsx, appelé une fois
  // qu'au moins un compte a été ajouté) — rafraîchit aussi le cookie de
  // session pour que le reste de la session reflète le changement sans
  // avoir à se reconnecter.
  api.post('/onboarding/complete', async (req, res, next) => {
    try {
      await completeOnboarding(req.orgId);
      const session = getSessionInfo(req);
      setSessionCookie(res, { ...session, onboardingCompleted: true });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // --- Compte utilisateur ---
  api.patch('/account/password', async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      await changePassword(req.userId, currentPassword, newPassword);
      res.json({ ok: true });
    } catch (error) {
      if (error.message.includes('incorrect') || error.message.includes('caractères') || error.message.includes('introuvable')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // --- Organisation ---
  api.patch('/organization', requireRole('owner', 'manager'), async (req, res, next) => {
    try {
      const name = await renameOrganization(req.orgId, req.body?.name);
      const session = getSessionInfo(req);
      setSessionCookie(res, { ...session, orgName: name });
      res.json({ ok: true, orgName: name });
    } catch (error) {
      if (error.message.includes('vide')) return res.status(400).json({ error: error.message });
      next(error);
    }
  });

  // Suppression définitive — réservée au owner. `name` doit correspondre
  // exactement au nom actuel (double confirmation : déjà tapé côté UI,
  // revérifié ici, voir org.js#deleteOrganization). Efface aussi le cookie
  // de session : l'organisation de l'utilisateur n'existe plus.
  api.delete('/organization', requireRole('owner'), async (req, res, next) => {
    try {
      await deleteOrganization(req.orgId, req.body?.name);
      clearSessionCookie(res);
      res.json({ ok: true });
    } catch (error) {
      if (error.message.includes('correspond') || error.message.includes('introuvable')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // --- Bot Discord (Token/Client ID/Guild ID — voir botConfig.js) ---
  // Réservé au owner : ce sont les identifiants de connexion du bot
  // lui-même, pas un réglage par organisation. Persistés dans .env,
  // n'ont d'effet qu'après redémarrage du process (npm start) — voir
  // l'avertissement affiché côté UI (SettingsView.jsx).
  api.get('/bot-config', requireRole('owner'), (req, res) => {
    res.json(getBotConfigStatus());
  });

  api.patch('/bot-config', requireRole('owner'), (req, res, next) => {
    try {
      const { discordToken, discordClientId, discordGuildId } = req.body || {};
      updateBotConfig({ discordToken, discordClientId, discordGuildId });
      res.json(getBotConfigStatus());
    } catch (error) {
      next(error);
    }
  });

  // --- Membres & invitations ---
  api.get('/members', async (req, res, next) => {
    try {
      res.json(await listMembers(req.orgId));
    } catch (error) {
      next(error);
    }
  });

  api.post('/members/invite', requireRole('owner', 'manager'), async (req, res, next) => {
    try {
      const { email, role } = req.body || {};
      const result = await inviteMember(req.orgId, req.userId, email, role);
      res.status(201).json(result);
    } catch (error) {
      if (error.message.includes('invalide') || error.message.includes('attente') || error.message.includes('déjà')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  api.delete('/members/:id', requireRole('owner'), async (req, res, next) => {
    try {
      await removeMember(req.orgId, req.params.id);
      res.json({ ok: true });
    } catch (error) {
      if (error.message.includes('introuvable') || error.message.includes('dernier propriétaire')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  app.use('/api', api);

  // Lien en bio trackable (voir bioLink.js) — route publique, volontairement
  // hors du routeur `api` protégé par requireAuth : c'est un lien collé
  // dans une bio Instagram/TikTok/YouTube publique, cliqué par n'importe
  // qui, pas par un utilisateur connecté au dashboard.
  app.get('/r/:slug', async (req, res, next) => {
    try {
      const target = await recordClickAndGetTarget(req.params.slug);
      if (!target) return res.status(404).send('Lien introuvable ou expiré.');
      res.redirect(302, target);
    } catch (error) {
      next(error);
    }
  });

  // --- Assets statiques du build React (voir web/, npm run build:web) ---
  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route inconnue' });
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => {
      res.status(503).send('Dashboard non buildé — lancez "npm run build:web" (voir README).');
    });
  }

  app.listen(config.port, () => {
    console.log(`Dashboard web disponible sur le port ${config.port}.`);
  });
}
