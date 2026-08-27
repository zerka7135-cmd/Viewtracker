import path from 'path';
import express from 'express';
import { getAccountsWithStats, getKpis, getHistorySeries, getHistorySeriesHourly, getAccountHistorySeries } from './dashboardData.js';
import { addAccount, updateAccount, deleteAccount } from './accountsStore.js';
import { loadSettings, updateSettings } from './settingsStore.js';
import { getBotConfigStatus, updateBotConfig } from './botConfig.js';
import { getScanStatus } from './scanStatus.js';
import {
  isPasswordSet, setInitialPassword, checkPassword, changePassword,
  setSessionCookie, clearSessionCookie, isAuthenticated,
  recordLoginFailure, recordLoginSuccess, loginDelayMs
} from './auth.js';

const WEB_DIST = path.resolve('./web/dist');

// Serveur HTTP du dashboard (API + assets statiques du build React, voir
// web/) — mot de passe unique (voir auth.js), pas de multi-utilisateur/
// organisation (voir backup/dashboard-rewrite-27-08 pour cette version-là,
// qui a besoin de Postgres). Un seul bot, un seul jeu de données
// (data/*.json), un seul propriétaire à authentifier.
//
// Aucune route ne déclenche de scan : la collecte reste uniquement pilotée
// par le cron planifié ou les scripts CLI (npm run scan / run-once) — voir
// src/scanStatus.js. GET /api/scan/status est en lecture seule.
export async function startServer() {
  const app = express();
  app.use(express.json());
  // Nécessaire pour que req.secure reflète le HTTPS réel derrière le proxy
  // Railway (qui termine le TLS et transmet en HTTP en interne) — sinon le
  // cookie de session ne serait jamais marqué `secure` en production.
  app.set('trust proxy', 1);

  // En-têtes de sécurité basiques — pas de CSP stricte ici : le bundle React
  // s'appuie sur des styles inline via la prop `style` (pas des balises
  // <style>/attributs style="", donc déjà hors du champ de style-src, mais
  // une CSP mal calibrée casserait facilement autre chose sans y avoir
  // vraiment goûté d'abord, pas le moment de le risquer juste avant la prod).
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // --- Auth (routes publiques, avant le middleware requireAuth ci-dessous) ---

  app.get('/api/me', (req, res) => {
    res.json({ passwordSet: isPasswordSet(), authenticated: isAuthenticated(req) });
  });

  // Uniquement tant qu'aucun mot de passe n'existe — passé ce point,
  // setInitialPassword() refuse (voir auth.js), il faut passer par
  // PATCH /api/account/password (authentifié) pour le changer.
  app.post('/api/setup-password', async (req, res, next) => {
    try {
      await setInitialPassword(req.body?.password || '');
      setSessionCookie(req, res);
      res.status(201).json({ ok: true });
    } catch (error) {
      if (error.message.includes('caractères') || error.message.includes('déjà configuré')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  app.post('/api/login', async (req, res, next) => {
    try {
      const delay = loginDelayMs();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

      const valid = await checkPassword(req.body?.password || '');
      if (!valid) {
        recordLoginFailure();
        return res.status(401).json({ error: 'Mot de passe incorrect' });
      }
      recordLoginSuccess();
      setSessionCookie(req, res);
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
      await changePassword(req.body?.currentPassword || '', req.body?.newPassword || '');
      res.json({ ok: true });
    } catch (error) {
      if (error.message.includes('incorrect') || error.message.includes('caractères')) {
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
