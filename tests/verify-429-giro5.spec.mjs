// #429 — quinta tornata: le pagine che NON sono HTML normale (immagine aperta
// da sola, pagina d'errore) continuano la scheda attiva?

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

const STATO = () => {
  const tabs = [...document.querySelectorAll('.tab')].map((el) => ({
    text: el.querySelector('.title') ? el.querySelector('.title').textContent : '',
    active: el.classList.contains('active'),
    bg: getComputedStyle(el).backgroundColor,
    w: Math.round(el.getBoundingClientRect().width),
  }));
  return { tabs, winW: window.innerWidth };
};

test.describe.configure({ mode: 'serial' });

test('#429/16 — immagine aperta da sola', async ({ shell, app }) => {
  const url = 'file:///home/user/Filo/assets/icons/icon-1024.png';
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await shell.waitForTimeout(3000);
  const st = await shell.evaluate(STATO);
  const attiva = st.tabs.find((t) => t.active);
  console.log('IMMAGINE — scheda attiva:', JSON.stringify(attiva));
  const pagina = app.windows().find((w) => { try { return w.url().endsWith('.png'); } catch (_) { return false; } });
  if (pagina) {
    const bg = await pagina.evaluate(() => getComputedStyle(document.body).backgroundColor + ' / html ' + getComputedStyle(document.documentElement).backgroundColor).catch((e) => 'errore: ' + e.message);
    console.log('sfondo della pagina immagine:', bg);
  } else {
    console.log('nessuna window per la pagina immagine (elenco:', app.windows().map((w) => w.url()).join(' | '), ')');
  }
  await shell.screenshot({ path: join(SHOTS, 'v429-immagine.png'), clip: { x: 0, y: 0, width: st.winW, height: 44 } });
});

test('#429/17 — pagina d\'errore (dominio inesistente)', async ({ shell, app }) => {
  await shell.evaluate(() => window.filoShell.tabs.open('http://questo-dominio-non-esiste-429.test/'));
  await shell.waitForTimeout(4000);
  const st = await shell.evaluate(STATO);
  const attiva = st.tabs.find((t) => t.active);
  console.log('ERRORE — scheda attiva:', JSON.stringify(attiva));
  console.log('finestre:', app.windows().map((w) => w.url()).join(' | '));
  await shell.screenshot({ path: join(SHOTS, 'v429-errore.png'), clip: { x: 0, y: 0, width: st.winW, height: 44 } });
});

test('#429/18 — pagina che cambia colore in cima dopo il caricamento', async ({ shell, app, testServer }) => {
  const url = testServer.html(`
    <title>Cambia colore</title>
    <body style="margin:0;background:#ffffff">
      <div id="t" style="height:60px;background:#ffffff"></div>
      <script>setTimeout(()=>{document.getElementById('t').style.background='rgb(180,20,140)';},3000);</script>
    </body>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await shell.waitForTimeout(2000);
  let st = await shell.evaluate(STATO);
  console.log('prima:', JSON.stringify(st.tabs.find((t) => t.active)));
  await shell.waitForTimeout(6000);
  st = await shell.evaluate(STATO);
  console.log('dopo il cambio (senza scroll né resize):', JSON.stringify(st.tabs.find((t) => t.active)));
  await shell.screenshot({ path: join(SHOTS, 'v429-cambio-colore.png'), clip: { x: 0, y: 0, width: st.winW, height: 44 } });
});
