import fs from 'fs';
import { chromium } from 'playwright';

const COOKIES_PATH = process.env.IG_COOKIES_PATH || './src/ig-cookies.json';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Connecte-toi manuellement à Instagram...');
  await page.goto('https://www.instagram.com/accounts/login/');

  await page.waitForTimeout(60000); // 60 secondes pour te connecter

  // On ne garde que le tableau de cookies (format attendu par
  // context.addCookies() dans instagram.js), pas le storageState complet.
  const { cookies } = await context.storageState();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  fs.chmodSync(COOKIES_PATH, 0o600); // Lecture/écriture réservées à l'utilisateur : la session IG complète est en clair dans ce fichier
  console.log(`Session sauvegardée dans ${COOKIES_PATH} !`);

  await browser.close();
})();
