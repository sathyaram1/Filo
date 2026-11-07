// Verifica #1509.3 giro 5: le porte dei giri passati ri-provate e chiuse, con tastiera e mouse veri del sistema (XTest).
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

test('primo Aiuto con la scorciatoia: le lettere battute subito entrano nella casella, non nel sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const s = await sito(app, openTab, testServer);
  const h = await Gesti.sulloSchermo(app, s, s, '#t');
  await veri(`clic:${h.x},${h.y + 200}`, 'attendi:0.3', 'combo:Alt_L+h', 'attendi:0.04', 'scrivi:qwertyuiop');
  const strato = await paginaDelloStrato(app, s);
  await expect.poll(() => valore(strato), { timeout: 5000 }).toBe('qwertyuiop');
  expect((await s.evaluate(() => window.__tasti)).filter((k) => k.length === 1)).toEqual([]);
});

test('Aiuto aperto, Ctrl+A e Ctrl+C veri nella casella: il sito non legge niente', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const s = await sito(app, openTab, testServer);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), id);
  const strato = await paginaDelloStrato(app, s);
  await strato.waitForSelector(casella);
  const c = await Gesti.sulloSchermo(app, s, strato, casella);
  await veri(`clic:${c.x},${c.y}`, 'scrivi:zibaldone', 'combo:Control_L+a', 'combo:Control_L+c');
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
  await veri(`clic:${c.x},${c.y}`, 'scrivi:abc');
  await testServer.openReady(openTab, '<!doctype html><title>altra</title><p>altra</p>');
  await s.waitForTimeout(400);
  await shell.evaluate((t) => window.filoShell.tabs.activate(t), id);
  await s.waitForTimeout(600);
  await veri('scrivi:def');
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

test('il pannello trascinato per la testata va dove lo porta il mouse, e ci si scrive ancora', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const s = await sito(app, openTab, testServer);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), id);
  const strato = await paginaDelloStrato(app, s);
  await strato.waitForSelector(casella);
  const prima = await strato.locator('.sn-sidebar').boundingBox();
  const testa = await Gesti.sulloSchermo(app, s, strato, '.sn-sidebar-header');
  Gesti.trascina({ x: testa.x - 60, y: testa.y }, { x: testa.x - 460, y: testa.y - 150 });
  const dopo = await strato.locator('.sn-sidebar').boundingBox();
  console.log('PANNELLO', JSON.stringify({ prima, dopo }));
  expect(Math.abs((prima.x - dopo.x) - 400)).toBeLessThan(15);
  const c = await Gesti.sulloSchermo(app, s, strato, casella);
  await veri(`clic:${c.x},${c.y}`, 'scrivi:spostato');
  await expect.poll(() => valore(strato)).toBe('spostato');
});

test('il testo scritto nell\'Aiuto si trascina in un campo della pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const s = await testServer.openReady(openTab, `<!doctype html><title>Campo</title><body style="margin:0;padding:40px"><input id="campo" style="width:300px;font-size:20px">${SPIA}</body>`);
  await Gesti.finestraASchermo(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), id);
  const strato = await paginaDelloStrato(app, s);
  await strato.waitForSelector(casella);
  const c = await Gesti.sulloSchermo(app, s, strato, casella);
  await veri(`clic:${c.x},${c.y}`, 'scrivi:trascinami', 'combo:Control_L+a');
  const box = await strato.locator(casella).boundingBox();
  const o = await Gesti.sulloSchermo(app, s, s, '#campo');
  const da = { x: c.x - box.width / 2 + 25, y: c.y - box.height / 2 + 12 };
  Gesti.trascina(da, o);
  await expect.poll(() => s.locator('#campo').inputValue(), { timeout: 5000 }).toContain('trascinami');
});

test('due schede con l\'Aiuto aperto: tornando su una si scrive nella sua casella', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const a = await sito(app, openTab, testServer);
  const idA = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), idA);
  const sa = await paginaDelloStrato(app, a);
  await sa.waitForSelector(casella);
  let c = await Gesti.sulloSchermo(app, a, sa, casella);
  await veri(`clic:${c.x},${c.y}`, 'scrivi:aaa');
  const b = await testServer.openReady(openTab, PAGINA.replace('Sito spia', 'Secondo'));
  const idB = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), idB);
  const sb = await paginaDelloStrato(app, b);
  await sb.waitForSelector(casella);
  c = await Gesti.sulloSchermo(app, b, sb, casella);
  await veri(`clic:${c.x},${c.y}`, 'scrivi:bbb');
  await shell.evaluate((t) => window.filoShell.tabs.activate(t), idA);
  await a.waitForTimeout(600);
  await veri('scrivi:ccc');
  await expect.poll(() => valore(sa)).toBe('aaaccc');
  expect(await valore(sb)).toBe('bbb');
  expect(await a.evaluate(() => window.__tasti.filter((k) => k.length === 1))).toEqual([]);
});
