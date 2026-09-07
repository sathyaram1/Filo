// Catture visive della striscia delle schede dopo le correzioni #429.
// Non asserisce: serve a guardare com'è venuta (chiaro, scuro, molte schede).

import { test } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

for (const tema of ['light', 'dark']) {
  test(`striscia schede (${tema})`, async ({ shell, testServer }) => {
    await shell.emulateMedia({ colorScheme: tema });
    const fav = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="rgb(240,240,240)"/></svg>');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://manage/manage.html'));
    await shell.waitForTimeout(1200);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(
      `<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${fav}"><title>Enciclopedia libera</title></head><body style="margin:0;background:#fff">t</body></html>`));
    await shell.waitForTimeout(1200);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(
      '<title>Rassegna stampa del mattino</title><body style="margin:0;background:rgb(24,60,110)">t</body>'));
    await shell.waitForTimeout(2500);
    await shell.screenshot({ path: join(SHOTS, `v429fix-${tema}.png`), clip: { x: 0, y: 0, width: 1100, height: 44 } });

    const nomi = ['Meteo Italia', 'Mercati e finanza', 'Musica classica', 'Mappe', 'Manuale',
      'Messaggi', 'Marketplace', 'Modelli 3D'];
    for (const n of nomi) {
      await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${n}</title><body style="margin:0;background:#fff">x</body>`));
    }
    await shell.waitForTimeout(2500);
    await shell.screenshot({ path: join(SHOTS, `v429fix-molte-${tema}.png`), clip: { x: 0, y: 0, width: 1280, height: 44 } });
  });
}
