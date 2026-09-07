// #429 — la via d'uscita: "niente colore sulle schede" spegne davvero tutto?

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

test('con il colore delle tab spento, la scheda in primo piano resta tinta di marchio?', async ({ shell, testServer }) => {
  const fav = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="rgb(220,20,20)"/></svg>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(
    `<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${fav}"><title>Video del giorno</title></head><body style="margin:0;background:#ffffff"><div style="height:1200px"></div></body></html>`));
  await shell.waitForTimeout(4000);
  const prima = await shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);

  // "niente colore sulle tab" (preset del setter a voce): opacita_tab = 0
  await shell.evaluate(async () => {
    await window.filoShell.settings.update({ tabColor: { opacita_tab: 0 } });
  }).catch(async () => {
    await shell.evaluate(async () => {
      const api = window.filoShell;
      if (api && api.updateSettings) await api.updateSettings({ tabColor: { opacita_tab: 0 } });
    });
  });
  await shell.waitForTimeout(3000);
  const dopo = await shell.evaluate(() => ({
    attiva: getComputedStyle(document.querySelector('.tab.active')).backgroundColor,
    dietro: [...document.querySelectorAll('.tab:not(.active)')].map((e) => getComputedStyle(e).backgroundColor),
  }));
  console.log('colore spento — prima attiva:', prima, 'dopo:', JSON.stringify(dopo));
  await shell.screenshot({ path: join(SHOTS, 'v429g12-spento.png'), clip: { x: 0, y: 0, width: 900, height: 44 } });
});
