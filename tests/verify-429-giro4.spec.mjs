// #429 — quarta tornata: il suggerimento che compare passando il mouse su una
// scheda col nome tagliato (è l'unico modo di leggere il nome intero).

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

async function bordiTip(app) {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const wins = BrowserWindow.getAllWindows();
    const main = wins.find((w) => w._filoTabs && !w._filoIncognito);
    const tip = wins.find((w) => w !== main && !w._filoTabs);
    const d = screen.getPrimaryDisplay().workAreaSize;
    return {
      schermo: d,
      quante: wins.length,
      tip: tip ? tip.getBounds() : null,
      visibile: tip ? tip.isVisible() : null,
    };
  });
}

test.describe.configure({ mode: 'serial' });

test('#429/14 — suggerimento di una scheda con titolo lungo ma realistico', async ({ shell, app, testServer }) => {
  const titolo = 'Come scegliere la bicicletta giusta: guida completa alle misure, ai materiali del telaio e ai rapporti — Rivista del Ciclismo, edizione di settembre';
  console.log('titolo lungo', titolo.length, 'caratteri');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${titolo}</title><body style="margin:0;background:#fff">x</body>`));
  await shell.waitForTimeout(2500);
  const pos = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => t.classList.contains('active'));
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), testo: el.querySelector('.title').textContent, tagliato: el.querySelector('.title').scrollWidth > el.querySelector('.title').clientWidth + 1 };
  });
  console.log('nella scheda si legge:', JSON.stringify(pos.testo), 'tagliato:', pos.tagliato);
  await shell.mouse.move(10, 10);
  await shell.mouse.move(pos.x, pos.y);
  await shell.waitForTimeout(1500);
  const b = await bordiTip(app);
  console.log('SUGGERIMENTO', JSON.stringify(b));
  if (b.tip) {
    console.log('larghezza suggerimento', b.tip.width, 'schermo', b.schermo.width, 'esce a destra di', (b.tip.x + b.tip.width) - b.schermo.width, 'px');
  }
});

test('#429/15 — suggerimento con titolo mostruoso (9.000 caratteri)', async ({ shell, app, testServer }) => {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${'Bicicletta '.repeat(800)}</title><body style="margin:0;background:#fff">x</body>`));
  await shell.waitForTimeout(2500);
  const pos = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => t.classList.contains('active'));
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await shell.mouse.move(10, 10);
  await shell.mouse.move(pos.x, pos.y);
  await shell.waitForTimeout(2000);
  const b = await bordiTip(app);
  console.log('SUGGERIMENTO MOSTRUOSO', JSON.stringify(b));
});
