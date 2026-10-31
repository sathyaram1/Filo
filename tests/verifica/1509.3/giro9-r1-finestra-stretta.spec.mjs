// Verifica #1509.3 giro 9, rilievo 1: rimpicciolita di colpo la finestra, l'Aiuto nello strato resta fuori vista.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';

const TASTI = join(dirname(fileURLToPath(import.meta.url)), 'tasti.py');
const veri = (...passi) => promisify(execFile)('python3', ['-I', TASTI, 'sequenza', ...passi], { env: process.env });
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif"><h1>Sito</h1><p style="height:600px">corpo</p>
  <script>window.__tasti = []; window.addEventListener('keydown', (e) => window.__tasti.push(e.key), true);</script></body></html>`;
const casella = '.sn-sidebar-input textarea';

test.skip(!Gesti.disponibili(), 'servono i gesti veri del sistema (Linux con X)');

test('r1 finestra rimpicciolita di colpo a metà con l\'Aiuto aperto: il pannello resta in vista e ci si continua a scrivere', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const s = await testServer.openReady(openTab, PAGINA);
  await Gesti.finestraASchermo(app);
  await s.waitForTimeout(400);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), id);
  const strato = await paginaDelloStrato(app, s);
  await strato.waitForSelector(casella);
  const c = await Gesti.sulloSchermo(app, s, strato, casella);
  await veri(`clic:${c.x},${c.y}`, 'scrivi:prima');
  await expect.poll(() => strato.locator(casella).inputValue()).toBe('prima');
  // Come la finestra messa a mezzo schermo: da larga a stretta in un colpo solo.
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => w._filoTabs).setSize(640, 800); });
  await s.waitForTimeout(2000);
  const larga = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs).getContentBounds().width);
  const cornice = await app.evaluate(({ BrowserWindow }) => [...BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.riquadri.strati.values()][0].cornice.getBounds());
  expect(cornice.x + Math.min(cornice.width, 40), 'la parte visibile dello strato sta dentro la finestra').toBeLessThanOrEqual(larga);
  const box = await strato.locator('.sn-sidebar').boundingBox();
  expect(box.x + box.width, 'il pannello sta dentro la finestra').toBeLessThanOrEqual(larga + 1);
  await veri('scrivi:dopo');
  await expect.poll(() => strato.locator(casella).inputValue(), { timeout: 5000 }).toBe('primadopo');
});
