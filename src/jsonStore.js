import fs from 'fs';
import path from 'path';

// Lecture/écriture des fichiers de données JSON (data/*.json), partagées par
// tous les stores (historique, cumul, comptes, réglages, auth...).
//
// Écriture atomique : on écrit d'abord dans un fichier temporaire à côté de
// la cible, puis on le renomme par-dessus. Un rename sur le même système de
// fichiers est atomique : si le process meurt en pleine écriture (OOM de
// Chromium, redéploiement Railway), l'ancien fichier reste intact au lieu
// d'être laissé à moitié écrit.
export function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
}

// Lecture tolérante : fichier absent -> `fallback`. Fichier illisible
// (JSON corrompu) -> il est d'abord mis de côté sous
// "<fichier>.corrupt-<horodatage>" avant de renvoyer `fallback`.
// Sans cette copie, l'appelant repartait de zéro puis réécrivait le fichier
// à la sauvegarde suivante : l'historique corrompu (donc encore récupérable
// à la main) était définitivement écrasé.
export function readJson(filePath, fallback, label = filePath) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(filePath, quarantinePath);
      console.error(`${label} illisible (${error.message}) : copie conservée dans ${quarantinePath}, on repart des valeurs par défaut.`);
    } catch (renameError) {
      console.error(`${label} illisible (${error.message}), et impossible de le mettre de côté :`, renameError.message);
    }
    return fallback;
  }
}
