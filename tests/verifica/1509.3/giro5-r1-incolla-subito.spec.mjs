// Verifica #1509.3 giro 5, rilievo 1: un Ctrl+V subito dopo la scorciatoia dell'Aiuto va al sito (tastiera vera, XTest).
import { test, expect } from '../../fixtures/electron.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';

const TASTI = join(dirname(fileURLToPath(import.meta.url)), 'tasti.py');
// Asincrono: un processo di prova fermo non lascia partire le viste nuove, che aspettano il debugger di Playwright.
const veri = (...passi) => promisify(execFile)('python3', ['-I', TASTI, 'sequenza', ...passi], { env: process.env });

const SPIA = `<script>
  window.__tasti = []; window.__letti = []; window.__incollati = [];
  const leggi = () => { try { const s = String(getSelection()); if (s) window.__letti.push(s); } catch (_) {} };
  document.addEventListener('selectionchange', leggi, true);
  for (const t of ['copy', 'cut', 'keyup', 'mouseup', 'input']) window.addEventListener(t, leggi, true);
  window.addEventListener('keydown', (e) => window.__tasti.push(e.key), true);
  window.addEventListener('paste', (e) => window.__incollati.push(e.clipboardData.getData('text')), true);
</script>`;
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Sito spia</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif"><h1 id="t">Frase da trascinare</h1><p style="height:600px">corpo</p>${SPIA}</body></html>`;

test.skip(!Gesti.disponibili(), 'servono i gesti veri del sistema (Linux con X)');

async function sito(app, openTab, testServer) {
  const s = await testServer.openReady(openTab, PAGINA);
  await Gesti.finestraASchermo(app);
  await s.waitForTimeout(500);
  return s;
}
const casella = '.sn-sidebar-input textarea';
const valore = (strato) => strato.locator(casella).inputValue();

test('r1 primo Aiuto con la scorciatoia: un Ctrl+V subito incolla nella casella, non nel sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('appunti-riservati-77'));
  const s = await sito(app, openTab, testServer);
  const h = await Gesti.sulloSchermo(app, s, s, '#t');
  await veri(`clic:${h.x},${h.y + 200}`, 'attendi:0.3', 'combo:Alt_L+h', 'attendi:0.12', 'combo:Control_L+v');
  const strato = await paginaDelloStrato(app, s);
  await expect.poll(() => valore(strato), { timeout: 5000 }).toBe('appunti-riservati-77');
  expect(await s.evaluate(() => window.__incollati)).toEqual([]);
});
