// Verifica #1509.3 giro 9: esplorazione (ricarica, navigazione, ancora, tema, finestra stretta) con tasti veri.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';

const TASTI = join(dirname(fileURLToPath(import.meta.url)), 'tasti.py');
const veri = (...passi) => promisify(execFile)('python3', ['-I', TASTI, 'sequenza', ...passi], { env: process.env });
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');

const SPIA = `<script>
  window.__tasti = (window.__tasti || []);
  window.addEventListener('keydown', (e) => window.__tasti.push(e.key), true);
</script>`;
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Sito spia</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;background:#fff"><h1 id="t">Titolo del sito</h1><a id="ancora" href="#giu">giu</a><p style="height:1600px">corpo</p><p id="giu">fondo</p>${SPIA}</body></html>`;

test.skip(!Gesti.disponibili(), 'servono i gesti veri del sistema (Linux con X)');

const casella = '.sn-sidebar-input textarea';
const valore = (strato) => strato.locator(casella).inputValue();
const attivo = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);

async function apri(app, shell, openTab, testServer, html = PAGINA) {
  const s = await testServer.openReady(openTab, html);
  await Gesti.finestraASchermo(app);
  await s.waitForTimeout(400);
  const id = await attivo(shell);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), id);
  const strato = await paginaDelloStrato(app, s);
  await strato.waitForSelector(casella);
  return { s, id, strato };
}

test('ricaricata la pagina con l\'Aiuto aperto, la scorciatoia lo riapre al primo colpo e ci si scrive', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const { s, id, strato } = await apri(app, shell, openTab, testServer);
  const c = await Gesti.sulloSchermo(app, s, strato, casella);
  await veri(`clic:${c.x},${c.y}`, 'scrivi:prima');
  await shell.evaluate((t) => window.filoShell.tabs.reload(t), id);
  await s.waitForLoadState('load');
  await s.waitForTimeout(1500);
  const h = await Gesti.sulloSchermo(app, s, s, '#t');
  await veri(`clic:${h.x},${h.y + 200}`, 'attendi:0.3', 'combo:Alt_L+h', 'attendi:1.5', 'scrivi:dopo');
  const st = await paginaDelloStrato(app, s);
  await expect.poll(() => valore(st), { timeout: 5000 }).toBe('dopo');
  expect((await s.evaluate(() => window.__tasti)).filter((k) => k.length === 1)).toEqual([]);
});

test('un salto ad ancora nella stessa pagina lascia l\'Aiuto aperto e la casella sua', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const { s, strato } = await apri(app, shell, openTab, testServer);
  const c = await Gesti.sulloSchermo(app, s, strato, casella);
  await veri(`clic:${c.x},${c.y}`, 'scrivi:uno');
  await s.evaluate(() => { location.hash = 'giu'; });
  await s.waitForTimeout(800);
  await veri('scrivi:due');
  await expect.poll(() => valore(strato)).toBe('unodue');
  expect((await s.evaluate(() => window.__tasti)).filter((k) => k.length === 1)).toEqual([]);
});

test('aspetto dell\'Aiuto su un sito, chiaro e scuro, e con la finestra stretta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const { s, strato } = await apri(app, shell, openTab, testServer);
  const c = await Gesti.sulloSchermo(app, s, strato, casella);
  await veri(`clic:${c.x},${c.y}`, 'scrivi:come si cambia la password');
  for (const tema of ['light', 'dark']) {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    await s.waitForTimeout(1200);
    const img = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find((w) => w._filoTabs).capturePage()).toPNG().toString('base64'));
    const fs = await import('node:fs');
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(join(SHOTS, `1509-giro9-${tema}.png`), Buffer.from(img, 'base64'));
  }
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setSize(640, 520); });
  await s.waitForTimeout(1200);
  const img = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find((w) => w._filoTabs).capturePage()).toPNG().toString('base64'));
  (await import('node:fs')).writeFileSync(join(SHOTS, '1509-giro9-stretta.png'), Buffer.from(img, 'base64'));
  const box = await strato.locator('.sn-sidebar').boundingBox();
  const vp = await strato.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  console.log('STRETTA', JSON.stringify({ box, vp }));
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.w + 1);
});

test('navigata la scheda a un altro sito con l\'Aiuto aperto, la scorciatoia lo apre al primo colpo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const { s, id } = await apri(app, shell, openTab, testServer);
  const altro = testServer.url ? null : null;
  await s.evaluate(() => { location.href = location.href.replace(/[?#].*$/, '') + '?altra=1'; });
  await s.waitForLoadState('load');
  await s.waitForTimeout(1500);
  const h = await Gesti.sulloSchermo(app, s, s, '#t');
  await veri(`clic:${h.x},${h.y + 200}`, 'attendi:0.3', 'combo:Alt_L+h', 'attendi:1.5', 'scrivi:nuovo');
  const st = await paginaDelloStrato(app, s);
  await expect.poll(() => valore(st), { timeout: 5000 }).toBe('nuovo');
  void altro; void id;
});
