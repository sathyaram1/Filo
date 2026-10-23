// Esplorazione del verificatore #1623: si cancella o si rinomina prima della registrazione.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function suDisco(nomi, byte = PNG) {
  const dir = cartellaInCasa('filo-verifica-1623-');
  return nomi.map((n) => { const p = join(dir, n); writeFileSync(p, byte); return p; });
}

async function lascia(page, files, { x = 200, y = 200, fasi = ['dragEnter', 'dragOver', 'drop'] } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of fasi) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}

const statoAiuto = (app, page) => nelMondoDiFilo(app, page, () => ({
  aperto: !!globalThis.SN_SIDEBAR?.isOpen?.(),
  allegati: (globalThis.__filoSidebarTest?.allegati?.() || []).map((a) => a.nome),
}));

async function home(app) {
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(page); }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible();
  return page;
}

test('E1 sito con casella di ricerca: immagine lasciata sulla casella', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><input id="q" type="search" style="position:fixed;left:50px;top:50px;width:500px;height:60px"></body></html>`);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto], { x: 200, y: 80 });
  await page.waitForTimeout(1500);
  const valore = await page.evaluate(() => document.getElementById('q').value);
  const st = await statoAiuto(app, page);
  console.log('E1', JSON.stringify({ valore, st, url: page.url() }));
});

test('E2 sito con editor contenteditable senza codice suo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><div id="ed" contenteditable style="position:fixed;left:50px;top:50px;width:500px;height:300px;border:1px solid #888">scrivi</div></body></html>`);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto], { x: 200, y: 150 });
  await page.waitForTimeout(1500);
  const html = await page.evaluate(() => document.getElementById('ed').innerHTML);
  const st = await statoAiuto(app, page);
  console.log('E2', JSON.stringify({ html: html.slice(0, 200), st }));
});

test('E3 home: trascinamento annullato, il campo si spegne?', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto], { x: 120, y: 120, fasi: ['dragEnter', 'dragOver'] });
  await expect(page.locator('#inputForm')).toHaveClass(/dash-input-bersaglio/);
  await lascia(page, [foto], { x: 120, y: 120, fasi: ['dragCancel'] });
  await page.waitForTimeout(800);
  console.log('E3 dopo annullo', await page.locator('#inputForm').getAttribute('class'));
});

test('E4 home: un pdf e un txt lasciati fuori dal campo entrano col percorso', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  const file = suDisco(['nota.txt', 'doc.pdf'], Buffer.from('ciao'));
  await lascia(page, file, { x: 120, y: 120 });
  await page.waitForTimeout(1000);
  console.log('E4', JSON.stringify(await page.locator('#imgPreviews .dash-file-chip').allTextContents()));
});

test('E5 sito: immagine lasciata sopra l’Aiuto aperto entra una volta', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;height:100vh">sito</body></html>');
  await nelMondoDiFilo(app, page, () => { globalThis.SN_SIDEBAR.open(); return 1; });
  await page.waitForTimeout(800);
  const vp = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const [foto] = suDisco(['foto.png']);
  // L'Aiuto sta a destra: si lascia vicino al bordo destro, in basso.
  await lascia(page, [foto], { x: vp.width - 60, y: vp.height - 60 });
  await page.waitForTimeout(1200);
  console.log('E5', JSON.stringify(await statoAiuto(app, page)), JSON.stringify(vp));
});

test('E6 sito: immagine e pdf insieme', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;height:100vh">sito</body></html>');
  const [foto] = suDisco(['foto.png']);
  const [pdf] = suDisco(['doc.pdf'], Buffer.from('%PDF-1.4'));
  await lascia(page, [foto, pdf]);
  await page.waitForTimeout(1500);
  const toast = await nelMondoDiFilo(app, page, () => document.querySelector('.sn-toast')?.textContent || '');
  console.log('E6', JSON.stringify(await statoAiuto(app, page)), toast);
});

test('E7 home tema scuro: campo acceso', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE({ type: MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' });
  });
  const page = await home(app);
  await page.waitForTimeout(800);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto], { x: 120, y: 120, fasi: ['dragEnter', 'dragOver'] });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v1623-home-scuro.png' });
  await lascia(page, [foto], { x: 120, y: 120, fasi: ['drop'] });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/v1623-home-scuro-dopo.png' });
});

test('E8 sito: immagine lasciata su un link o una foto della pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><a href="#x" style="display:block;position:fixed;left:0;top:0;width:400px;height:300px;background:#eee">link</a></body></html>`);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto], { x: 150, y: 150 });
  await page.waitForTimeout(1500);
  console.log('E8', JSON.stringify(await statoAiuto(app, page)), page.url());
});
