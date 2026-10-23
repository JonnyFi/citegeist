// Ad-hoc debugging helper: node scripts/debug.mjs <pdf> <js expression using window.spike>
import { chromium } from '@playwright/test';

const [name, expr] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => console.log('[console]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5183/?pdf=${name}`);
await page.waitForSelector('body[data-ready="1"]', { timeout: 120000 });
const out = await page.evaluate(`(async () => { ${expr} })()`);
console.log(JSON.stringify(out, null, 1));
await browser.close();
