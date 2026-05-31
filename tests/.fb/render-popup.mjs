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
  const menuHtml = buildHTML(entries, dark, MARGIN);
  const page = await browser.newPage({ viewport: { width: WIN_W, height: WIN_H } });
  // Pagina host con sfondo a scacchiera (simula la WebContentsView dietro il
  // popup trasparente) e un iframe trasparente che contiene il menu reale: così
  // vediamo il menu, il gutter trasparente e l'ombra contro lo sfondo.
  const host = `<!DOCTYPE html><html><head><style>
    html,body{margin:0;height:100%;overflow:hidden}
    body{background:${dark ? '#2b2a28' : '#cfcabf'};
      background-image:linear-gradient(45deg,#00000018 25%,transparent 25%,transparent 75%,#00000018 75%),
      linear-gradient(45deg,#00000018 25%,transparent 25%,transparent 75%,#00000018 75%);
      background-size:16px 16px;background-position:0 0,8px 8px}
    iframe{border:0;width:${WIN_W}px;height:${WIN_H}px;background:transparent;display:block}
  </style></head><body><iframe id="f"></iframe></body></html>`;
  await page.setContent(host);
  await page.evaluate((mh) => {
    const f = document.getElementById('f');
    f.srcdoc = mh;
  }, menuHtml);
  await page.waitForTimeout(200);
  const out = path.join(__dirname, `popup_account_${dark ? 'dark' : 'light'}.png`);
  await page.screenshot({ path: out });
  console.log('shot', out);
  await page.close();
}
await browser.close();
