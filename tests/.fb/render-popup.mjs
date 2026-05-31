// Verifica visiva FB4: rende il popup menu account (email + Esci) con il
// buildHTML reale del main, per ispezionare centraggio email e ombra.
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const { buildHTML, computeMenuWidth } = require(path.join(ROOT, 'src/main/popup-menu.js'));

const entries = [
  { label: 'sathyarampontillo@gmail.com', disabled: true },
  { type: 'separator' },
  { label: 'Esci', icon: 'close', action: 'auth-signout' },
];

const MARGIN = 26, ITEM_H = 36, SEP_H = 9, PAD = 8;
const WIDTH = computeMenuWidth(entries);
let contentH = PAD * 2;
for (const e of entries) contentH += e.type === 'separator' ? SEP_H : ITEM_H;
const WIN_W = WIDTH + MARGIN * 2;
const WIN_H = contentH + MARGIN * 2;
console.log('menu width', WIDTH, '| window', WIN_W + 'x' + WIN_H);

const browser = await chromium.launch();
for (const dark of [false, true]) {
  const html = buildHTML(entries, dark, MARGIN);
  const page = await browser.newPage({ viewport: { width: WIN_W, height: WIN_H } });
  // Sfondo a scacchiera tenue per vedere la trasparenza + ombra del menu.
  await page.goto('data:text/html,' + encodeURIComponent(
    `<style>html,body{margin:0;height:100%}body{background:
      ${dark ? '#2b2a28' : '#cfcabf'};
      background-image:linear-gradient(45deg,#0002 25%,transparent 25%,transparent 75%,#0002 75%),
      linear-gradient(45deg,#0002 25%,transparent 25%,transparent 75%,#0002 75%);
      background-size:16px 16px;background-position:0 0,8px 8px}</style>` + html));
  await page.waitForTimeout(150);
  const out = path.join(__dirname, `popup_account_${dark ? 'dark' : 'light'}.png`);
  await page.screenshot({ path: out });
  console.log('shot', out);
  await page.close();
}
await browser.close();
