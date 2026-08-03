import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

// Ouvre un navigateur visible pour que l'utilisateur se connecte manuellement
// à Instagram, puis exporte les cookies de session dans src/ig-cookies.json
// (chemin attendu par src/instagram.js, cf. IG_COOKIES_PATH).

const OUTPUT_PATH = process.env.IG_COOKIES_PATH || path.resolve('./src/ig-cookies.json');

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.instagram.com/accounts/login/');

  const triggerPath = path.resolve('./scripts/.ig-login-done');
  try { fs.unlinkSync(triggerPath); } catch {}

  console.log('Connecte-toi manuellement à Instagram dans la fenêtre ouverte.');
  console.log(`Une fois connecté (page d'accueil / profil visible), crée le fichier ${triggerPath} pour continuer.`);

  await waitForFile(triggerPath);
  try { fs.unlinkSync(triggerPath); } catch {}

  const cookies = await context.cookies();
  const igCookies = cookies.filter(c => c.domain.includes('instagram.com'));

  if (!igCookies.some(c => c.name === 'sessionid')) {
    console.error('Aucun cookie "sessionid" trouvé — la connexion n\'a probablement pas abouti. Fichier non écrit.');
    await browser.close();
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(igCookies, null, 2));
  console.log(`Cookies Instagram exportés vers ${OUTPUT_PATH}`);

  await browser.close();
}

function waitForFile(filePath) {
  return new Promise(resolve => {
    const interval = setInterval(() => {
      if (fs.existsSync(filePath)) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
