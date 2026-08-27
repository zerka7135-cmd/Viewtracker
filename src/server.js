import path from 'path';
import express from 'express';
import { config } from './config.js';
import { getAccountsWithStats, getKpis, getHistorySeries, getHistorySeriesHourly, getAccountHistorySeries } from './dashboardData.js';
import { addAccount, updateAccount, deleteAccount } from './accountsStore.js';
import { loadSettings, updateSettings } from './settingsStore.js';
import { getScanStatus } from './scanStatus.js';

const WEB_DIST = path.resolve('./web/dist');

// Serveur HTTP du dashboard (API + assets statiques du build React, voir
// web/) — version sans auth/multi-organisation (voir
// backup/dashboard-rewrite-27-08 pour la version avec comptes utilisateurs,
// organisations et suivi de clics). Un seul bot, un seul jeu de données
// (data/*.json) : pas de login, protégé en amont par le réseau plutôt que
// par une session applicative — voir README pour les implications.
//
// Aucune route ne déclenche de scan : la collecte reste uniquement pilotée
// par le cron planifié ou les scripts CLI (npm run scan / run-once) — voir
// src/scanStatus.js. GET /api/scan/status est en lecture seule.
export async function startServer() {
  const app = express();
  app.use(express.json());

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

  app.get('/api/scan/status', (req, res) => {
    res.json(getScanStatus());
  });

  // Assets statiques du build React (voir `npm run build:web`) — après les
  // routes /api pour qu'elles restent prioritaires, et avec un fallback
  // vers index.html pour que les routes côté client (aucune ici pour
  // l'instant, mais gardé pour un futur routeur) ne 404 pas au rechargement.
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
