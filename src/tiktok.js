import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// yt-dlp (binaire autonome installé dans l'image, voir Dockerfile) liste les
// dernières vidéos d'un compte TikTok et renvoie directement leurs vues, sans
// navigateur : le captcha slider de TikTok bloque tout Playwright piloté par
// script (testé le 08/08/2026), et l'ancien fournisseur d'API tiers
// (tiktokapi.store) a disparu en septembre 2026 (le domaine ne se résout plus).
// En local, YTDLP_PATH permet de pointer vers un yt-dlp installé ailleurs.
const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';

// TikTok autorise jusqu'à 3 vidéos épinglées, qui remontent en tête de liste
// quelle que soit leur date. yt-dlp ne les signale pas : on demande donc
// quelques vidéos de plus que nécessaire, puis on garde les plus récentes
// (par date de publication) — ce qui écarte naturellement une épinglée ancienne.
const PINNED_MARGIN = 3;

const TIMEOUT_MS = 60000;

/**
 * Extrait les vidéos les plus récentes de la sortie de
 * `yt-dlp --flat-playlist -j` (un objet JSON par ligne, mélangé à d'éventuels
 * avertissements texte qu'on ignore).
 * @param {string} stdout
 * @param {number} limit Nombre de vidéos récentes à garder
 * @returns {Array<{id: string, views: number, timestamp: number}>} plus récente d'abord
 */
export function parseTikTokEntries(stdout, limit) {
  const entries = [];

  for (const line of (stdout || '').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry.id) continue;
      entries.push({
        id: String(entry.id),
        views: Number.isFinite(entry.view_count) ? entry.view_count : 0,
        timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : 0
      });
    } catch {
      // ligne JSON tronquée : on l'ignore plutôt que de faire échouer tout le compte
    }
  }

  return entries.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

/**
 * Récupère les vues des dernières vidéos d'un compte TikTok.
 * Même contrat de retour que les autres plateformes de instagram.js
 * (`{ total, posts }`), pour scrapeWithRetry.
 * @param {string} profileUrl ex. https://www.tiktok.com/@compte
 * @param {number} limit Nombre de vidéos récentes à compter
 * @returns {Promise<{total: number, posts: Array<{id: string, views: number}>}>}
 */
export async function fetchTikTokPosts(profileUrl, limit) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      YTDLP_PATH,
      ['--flat-playlist', '--playlist-end', String(limit + PINNED_MARGIN), '-j', '--no-warnings', profileUrl],
      { timeout: TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 }
    ));
  } catch (e) {
    // yt-dlp sort en erreur avec un message explicite sur stderr (ex. compte
    // privé) : on le remonte plutôt que le "Command failed" générique.
    const detail = (e.stderr || '').split('\n').find(l => /ERROR|WARNING/.test(l));
    throw new Error(`yt-dlp : ${detail ? detail.replace(/^\s*(ERROR|WARNING):\s*/, '') : e.message}`);
  }

  const videos = parseTikTokEntries(stdout, limit);
  if (videos.length === 0) {
    throw new Error(`yt-dlp n'a renvoyé aucune vidéo pour ${profileUrl}`);
  }

  return {
    total: videos.reduce((sum, v) => sum + v.views, 0),
    posts: videos.map(v => ({ id: v.id, views: v.views }))
  };
}
