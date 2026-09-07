// #429 — sesta tornata: la pagina cambia colore SENZA che l'utente scrolli o
// ridimensioni (passaggio chiaro/scuro, interruttore del sito, banner tardivo).

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

const ATTIVA = () => {
  const el = [...document.querySelectorAll('.tab')].find((t) => t.classList.contains('active'));
  return el ? { text: el.querySelector('.title').textContent, bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color } : null;
};

async function apriInterna(shell, app, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return w.url().startsWith(url); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded').catch(() => {}); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('non aperta');
}

test.describe.configure({ mode: 'serial' });

test('#429/19 — la pagina passa a scuro: la scheda attiva la segue?', async ({ shell, app }) => {
  const page = await apriInterna(shell, app, 'filo://manage/manage.html');
  await shell.waitForTimeout(2500);
  console.log('chiaro:', JSON.stringify(await shell.evaluate(ATTIVA)));
  const bgChiaro = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  await shell.waitForTimeout(4000);
  const bgScuro = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dopo = await shell.evaluate(ATTIVA);
  console.log('pagina: da', bgChiaro, 'a', bgScuro);
  console.log('scheda attiva DOPO il passaggio a scuro (nessuno scroll, nessun ridimensionamento):', JSON.stringify(dopo));
  await shell.screenshot({ path: join(SHOTS, 'v429-tema-cambiato.png'), clip: { x: 0, y: 0, width: 700, height: 44 } });
  // e ora basta uno scroll per farla allineare?
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await shell.waitForTimeout(1500);
  console.log('dopo un evento di scroll:', JSON.stringify(await shell.evaluate(ATTIVA)));
});

test('#429/20 — il sito accende il suo tema scuro da un interruttore interno', async ({ shell, app, testServer }) => {
  const url = testServer.html(`
    <title>Sito con interruttore</title>
    <body style="margin:0;background:#ffffff">
      <div id="top" style="height:80px;background:#ffffff">barra</div>
      <button id="b" style="position:fixed;bottom:10px;left:10px">scuro</button>
      <script>document.getElementById('b').onclick=()=>{document.getElementById('top').style.background='rgb(18,18,18)';document.body.style.background='rgb(18,18,18)';};</script>
    </body>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await shell.waitForTimeout(2500);
  console.log('prima:', JSON.stringify(await shell.evaluate(ATTIVA)));
  const pagina = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
  expect(pagina, 'pagina trovata').toBeTruthy();
  await pagina.click('#b');
  await shell.waitForTimeout(4000);
  console.log('dopo il clic sull\'interruttore del sito:', JSON.stringify(await shell.evaluate(ATTIVA)));
  console.log('cima pagina ora:', await pagina.evaluate(() => getComputedStyle(document.getElementById('top')).backgroundColor));
  await shell.screenshot({ path: join(SHOTS, 'v429-interruttore-sito.png'), clip: { x: 0, y: 0, width: 700, height: 44 } });
});
