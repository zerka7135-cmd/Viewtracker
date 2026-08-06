import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

// Ouvre un navigateur visible pour que l'utilisateur se connecte manuellement
// à TikTok, puis exporte les cookies de session dans src/tiktok-cookies.json
// (chemin attendu par TIKTOK_COOKIES_PATH, cf. src/instagram.js).
//
// On utilise playwright-extra + le plugin stealth (comme dans src/instagram.js)
// pour masquer les signaux d'automatisation (navigator.webdriver, etc.) que
// TikTok utilise pour bloquer les navigateurs pilotés par script.

const OUTPUT_PATH = process.env.TIKTOK_COOKIES_PATH || path.resolve('./src/tiktok-cookies.json');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();

  await page.goto('https://www.tiktok.com/login');

  const triggerPath = path.resolve('./scripts/.tiktok-login-done');
  try { fs.unlinkSync(triggerPath); } catch {}

  console.log('Connecte-toi manuellement à TikTok dans la fenêtre ouverte.');
  console.log(`Une fois connecté (page d'accueil / profil visible), crée le fichier ${triggerPath} pour continuer.`);

  await waitForFile(triggerPath);
  try { fs.unlinkSync(triggerPath); } catch {}

  const cookies = await context.cookies();
  const ttCookies = cookies.filter(c => c.domain.includes('tiktok.com'));

  if (!ttCookies.some(c => c.name === 'sessionid')) {
    console.error('Aucun cookie "sessionid" trouvé — la connexion n\'a probablement pas abouti. Fichier non écrit.');
    await browser.close();
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(ttCookies, null, 2));
  fs.chmodSync(OUTPUT_PATH, 0o600); // Lecture/écriture réservées à l'utilisateur : la session TikTok est en clair dans ce fichier
  console.log(`Cookies TikTok exportés vers ${OUTPUT_PATH}`);

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
