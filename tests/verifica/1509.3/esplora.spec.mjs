// Verifica #1509.3 giro 5: le porte dei giri passati, con tastiera e mouse veri del sistema (XTest).
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';

const TASTI = join(dirname(fileURLToPath(import.meta.url)), 'tasti.py');
const veri = (...passi) => execFileSync('python3', ['-I', TASTI, 'sequenza', ...passi], { env: process.env });

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

test('primo Aiuto con la scorciatoia: le lettere battute subito entrano nella casella, non nel sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const s = await sito(app, openTab, testServer);
  const h = await Gesti.sulloSchermo(app, s, s, '#t');
  veri(`clic:${h.x},${h.y + 200}`, 'attendi:0.3', 'combo:Alt_L+h', 'scrivi:qwertyuiop');
  const strato = await paginaDelloStrato(app, s);
  await expect.poll(() => valore(strato), { timeout: 5000 }).toBe('qwertyuiop');
  expect((await s.evaluate(() => window.__tasti)).filter((k) => k.length === 1)).toEqual([]);
});

test('primo Aiuto con la scorciatoia: un Ctrl+V subito incolla nella casella, non nel sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('appunti-riservati-77'));
  const s = await sito(app, openTab, testServer);
  const h = await Gesti.sulloSchermo(app, s, s, '#t');
  veri(`clic:${h.x},${h.y + 200}`, 'attendi:0.3', 'combo:Alt_L+h', 'combo:Control_L+v');
  const strato = await paginaDelloStrato(app, s);
  await expect.poll(() => valore(strato), { timeout: 5000 }).toBe('appunti-riservati-77');
  expect(await s.evaluate(() => window.__incollati)).toEqual([]);
});

test('Aiuto aperto, Ctrl+A e Ctrl+C veri nella casella: il sito non legge niente', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const s = await sito(app, openTab, testServer);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), id);
  const strato = await paginaDelloStrato(app, s);
  await strato.waitForSelector(casella);
  const c = await Gesti.sulloSchermo(app, s, strato, casella);
  veri(`clic:${c.x},${c.y}`, 'scrivi:zibaldone', 'combo:Control_L+a', 'combo:Control_L+c');
  await expect.poll(() => valore(strato)).toBe('zibaldone');
  await s.waitForTimeout(300);
  expect(JSON.stringify(await s.evaluate(() => [window.__tasti, window.__letti]))).not.toContain('zibaldone');
  expect(await s.evaluate(() => window.__tasti.filter((k) => k.length === 1))).toEqual([]);
});

test('tornati da un\'altra scheda si continua a scrivere nella casella', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const s = await sito(app, openTab, testServer);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), id);
  const strato = await paginaDelloStrato(app, s);
  await strato.waitForSelector(casella);
  const c = await Gesti.sulloSchermo(app, s, strato, casella);
  veri(`clic:${c.x},${c.y}`, 'scrivi:abc');
  await testServer.openReady(openTab, '<!doctype html><title>altra</title><p>altra</p>');
  await s.waitForTimeout(400);
  await shell.evaluate((t) => window.filoShell.tabs.activate(t), id);
  await s.waitForTimeout(600);
  veri('scrivi:def');
  await expect.poll(() => valore(strato)).toBe('abcdef');
  expect(await s.evaluate(() => window.__tasti.filter((k) => k.length === 1))).toEqual([]);
});

test('una frase della pagina trascinata nella casella dell\'Aiuto ci entra', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const s = await sito(app, openTab, testServer);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), id);
  const strato = await paginaDelloStrato(app, s);
  await strato.waitForSelector(casella);
  await s.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('t')); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const da = await Gesti.sulloSchermo(app, s, s, '#t');
  const a = await Gesti.sulloSchermo(app, s, strato, casella);
  Gesti.trascina({ x: da.x - 30, y: da.y }, a);
  await expect.poll(() => valore(strato), { timeout: 5000 }).toContain('Frase da trascinare');
});
