import cron from 'node-cron';
import { getDefaultOrgId } from './org.js';
import { loadSettings } from './settingsStore.js';
import { runScanCycle } from './scanCycle.js';

// Planification automatique du bot — un seul job pour l'instant (mono-
// tenant), reprogrammable dynamiquement quand cronSchedule/timezone
// changent pour l'organisation par défaut (voir PATCH /api/settings dans
// server.js) sans redémarrer le process. Le vrai scheduler multi-tenant
// (un job par organisation) reste un chantier à part — ce module ne gère
// que l'organisation par défaut ("Mon Serveur"), la seule qui poste
// réellement sur Discord aujourd'hui.

let task = null;
let cachedClient = null;

function scheduleJob(schedule, timezone) {
  if (task) task.stop();

  task = cron.schedule(
    schedule,
    async () => {
      // Décale le déclenchement réel de 0 à 120 min après l'heure planifiée :
      // une collecte qui démarre à la seconde près, tous les jours depuis la
      // même IP serveur, est un signal d'automatisation facile à repérer.
      const jitterMs = Math.floor(Math.random() * 120 * 60 * 1000);
      console.log(`Déclenchement cron : collecte différée de ${Math.round(jitterMs / 60000)} min.`);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));

      try {
        const { sent } = await runScanCycle(cachedClient);
        if (sent) console.log('Résumé automatique envoyé.');
      } catch (error) {
        console.error('Erreur lors de l\'envoi automatique du résumé :', error);
      }
    },
    { timezone }
  );

  console.log(`Planification active : "${schedule}" (${timezone})`);
}

/** Démarre le scheduler au boot (voir src/index.js, appelé une fois le client Discord prêt). */
export async function startScheduler(client) {
  cachedClient = client;
  const orgId = await getDefaultOrgId();
  const settings = await loadSettings(orgId);
  scheduleJob(settings.cronSchedule, settings.timezone);
}

/**
 * Reprogramme le job si `cronSchedule`/`timezone` viennent de changer pour
 * l'organisation par défaut (voir PATCH /api/settings) — no-op pour toute
 * autre organisation, qui n'a pas de cron réel pour l'instant.
 */
export async function rescheduleIfDefaultOrg(orgId) {
  if (!cachedClient) return; // scheduler pas encore démarré (client Discord pas prêt)

  const defaultOrgId = await getDefaultOrgId();
  if (orgId !== defaultOrgId) return;

  const settings = await loadSettings(orgId);
  scheduleJob(settings.cronSchedule, settings.timezone);
}
