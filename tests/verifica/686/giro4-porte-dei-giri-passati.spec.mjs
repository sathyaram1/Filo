// #686 — giro 4: si ri-provano le porte che i tre giri passati hanno chiuso.
//
// Il danno raccontato ogni volta è lo stesso: il sito decide lui lo zoom, o lo
// spegne, e chi ha bisogno di leggere grande resta a bocca asciutta. Qui stanno
// tutte le strade già curate, in fila, perché non si riaprano.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>sito</title></head>
<body style="height:4000px"><h1>un sito qualunque</h1><p>testo</p></body></html>`;

const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

async function percentOf(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.getZoomFactor();
    }
    return null;
  }, url);
  return f == null ? null : Math.round(f * 100);
}

test('il sito non disfa lo zoom coi segnali nel documento né fingendosi una pagina che si zooma da sé', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  // Giro 1, prima porta: il segnale «riporta al 100%» emesso dalla pagina.
  await page.evaluate(() => {
    document.dispatchEvent(new Event('filo:zoom-azzera'));
    document.dispatchEvent(new Event('filo:zoom-reset'));
    document.dispatchEvent(new Event('filo:zoom-out'));
  });
  await page.waitForTimeout(400);
  expect(await percentOf(app, page), 'un segnale della pagina ha mosso lo zoom').toBe(200);

  // Giro 1, seconda porta: il sito si dichiara padrone del proprio zoom.
  await page.evaluate(() => {
    document.documentElement.dataset.filoOwnZoom = '1';
    document.documentElement.dataset.filoOwnZoomPercent = '100';
  });
  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 300 });
  await expect.poll(async () => percentOf(app, page)).toBe(300);
  expect(r.output && r.output.zoom, 'Filo dice «fatto» senza dire il numero, credendo al sito').toBe('ok');
  expect(r.output.percentuale).toBe(300);
});

test('il sito non muove lo zoom fingendo i gesti dell\'utente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  // Giro 2: Ctrl 0 finto, Ctrl+rotella finti, clic centrale finto.
  await page.evaluate(() => {
    for (const key of ['0', '-', '-', '-']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
    }
    for (let i = 0; i < 6; i++) {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true }));
      document.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true }));
    }
    window.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true }));
  });
  await page.waitForTimeout(400);
  expect(await percentOf(app, page), 'un gesto finto ha mosso lo zoom').toBe(200);
  await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
});

test('il sito non rimette lo zoom dal campo del riquadro (Invio finto, uscita finta, fuoco più clic vero)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  await page.mouse.click(200, 200, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();

  // Invio finto.
  await page.evaluate(() => {
    const i = document.getElementById('__filo-zoom-percent');
    i.value = '25';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await page.waitForTimeout(300);
  expect(await percentOf(app, page)).toBe(200);

  // Uscita dal campo finta.
  await page.evaluate(() => {
    const i = document.getElementById('__filo-zoom-percent');
    i.value = '25';
    i.dispatchEvent(new FocusEvent('blur'));
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  expect(await percentOf(app, page)).toBe(200);

  // Niente di finto: scrive, mette il fuoco, e aspetta un clic vero dell'utente.
  await page.evaluate(() => {
    const i = document.getElementById('__filo-zoom-percent');
    i.value = '25';
    i.focus();
  });
  await page.mouse.click(300, 300);
  await page.waitForTimeout(400);
  expect(await percentOf(app, page), 'il numero scritto dal sito è diventato lo zoom').toBe(200);
});

test('il sito non spegne i gesti veri dell\'utente zittendoli sulla finestra', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('h1').click();
  await page.evaluate(() => {
    for (const t of ['keydown', 'keyup', 'wheel', 'mousedown', 'mouseup', 'click']) {
      window.addEventListener(t, (e) => { e.stopImmediatePropagation(); e.preventDefault(); }, true);
      document.addEventListener(t, (e) => { e.stopImmediatePropagation(); e.preventDefault(); }, true);
    }
  });

  // Tasti.
  await page.keyboard.press('Control+=');
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBeGreaterThan(100);
  await page.keyboard.press('Control+0');
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(100);

  // Ctrl+rotella.
  await page.mouse.move(200, 200);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBeGreaterThan(100);

  // Clic centrale: apre la modalità rotella.
  await page.mouse.click(200, 300, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
});
