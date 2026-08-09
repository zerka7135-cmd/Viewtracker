import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 500 } });

await page.goto('http://localhost:3000');
await page.waitForSelector('input[type="email"]');
await page.screenshot({ path: '.screenshot-login.png' });

await page.click('text=Pas de compte ? En créer un');
await page.waitForSelector('text=Créer une nouvelle organisation vide');
await page.screenshot({ path: '.screenshot-signup.png' });

await browser.close();
console.log('done');
