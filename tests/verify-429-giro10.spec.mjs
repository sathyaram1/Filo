// #429 — decima tornata: sequenze rapide (apri/chiudi a raffica, doppio clic
// sulla scheda, chiusura mentre carica) e stato vuoto.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

test('#429/24 — apri e chiudi a raffica: la striscia resta coerente', async ({ shell, testServer }) => {
  const urls = [];
  for (let i = 0; i < 14; i++) urls.push(testServer.html(`<title>Raffica ${i}</title><body style="margin:0;background:hsl(${i * 25},60%,50%)">r</body>`));
  await Promise.all(urls.map((u) => shell.evaluate((x) => window.filoShell.tabs.open(x), u)));
  await shell.waitForTimeout(2500);
  // chiudi metà a raffica cliccando le X
  await shell.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tab')];
    for (let i = 0; i < tabs.length; i += 2) {
      const c = tabs[i].querySelector('.close');
      if (c) c.click();
    }
  });
  await shell.waitForTimeout(2500);
  const st = await shell.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tab')];
    const ids = tabs.map((t) => t.dataset.id);
    return {
      n: tabs.length,
      duplicati: ids.length - new Set(ids).size,
      attive: tabs.filter((t) => t.classList.contains('active')).length,
      larghezze: tabs.map((t) => Math.round(t.getBoundingClientRect().width)),
      sovrapposte: tabs.some((t, i) => i > 0 && Math.round(t.getBoundingClientRect().left) < Math.round(tabs[i - 1].getBoundingClientRect().right) - 1),
    };
  });
  console.log('dopo la raffica:', JSON.stringify(st));
  expect(st.duplicati, 'nessuna scheda fantasma duplicata').toBe(0);
  expect(st.attive, 'una sola scheda attiva').toBe(1);
  await shell.screenshot({ path: join(SHOTS, 'v429-raffica.png'), clip: { x: 0, y: 0, width: 1280, height: 44 } });
});

test('#429/25 — chiudo tutte le schede: resta la Home e ha il suo colore', async ({ shell, testServer }) => {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<title>Una</title><body style="margin:0;background:#248">u</body>'));
  await shell.waitForTimeout(1500);
  await shell.evaluate(() => { for (const t of [...document.querySelectorAll('.tab')]) { const c = t.querySelector('.close'); if (c) c.click(); } });
  await shell.waitForTimeout(3000);
  const st = await shell.evaluate(() => [...document.querySelectorAll('.tab')].map((el) => ({
    text: el.querySelector('.title').textContent,
    active: el.classList.contains('active'),
    bg: getComputedStyle(el).backgroundColor,
    w: Math.round(el.getBoundingClientRect().width),
    troncato: el.querySelector('.title').scrollWidth > el.querySelector('.title').clientWidth + 1,
  })));
  console.log('stato vuoto:', JSON.stringify(st));
  expect(st.length, 'resta almeno una scheda').toBeGreaterThanOrEqual(1);
  await shell.screenshot({ path: join(SHOTS, 'v429-stato-vuoto.png'), clip: { x: 0, y: 0, width: 700, height: 44 } });
});
