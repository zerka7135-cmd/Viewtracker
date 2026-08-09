import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 700 } });

await page.goto('http://localhost:3000');
await page.waitForSelector('input[type="email"]');
await page.locator('.btn-link').click();
await page.fill('input[type="email"]', 'onboard-visual@example.com');
await page.fill('input[type="password"]', 'motdepasse123');
await page.click('button[type="submit"]');

await page.waitForSelector('text=Bienvenue sur ViewTracker', { timeout: 10000 });
await page.screenshot({ path: '.screenshot-onboarding-empty.png' });

await page.fill('input[placeholder="Nom du compte (ex: mon_compte)"]', 'mon_clippeur');
await page.fill('input[placeholder="URL TikTok (optionnel)"]', 'https://www.tiktok.com/@mon_clippeur');
await page.click('button:has-text("+ Ajouter à la liste")');
await page.waitForSelector('text=mon_clippeur');
await page.screenshot({ path: '.screenshot-onboarding-added.png' });

await page.click('button:has-text("Terminer")');
await page.waitForSelector('text=Classement des comptes', { timeout: 10000 });
await page.screenshot({ path: '.screenshot-dashboard-after.png' });

console.log('done');
await browser.close();
