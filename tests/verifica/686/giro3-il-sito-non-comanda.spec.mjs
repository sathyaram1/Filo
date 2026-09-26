// #686 — giro 3: lo zoom lo decide l'utente, non il sito.
//
// Nei due giri passati il sito riusciva a rimettersi la misura che voleva
// prima col marcatore nel documento, poi fingendo i gesti dell'utente. Qui si
// prova la stessa cosa dalle strade rimaste.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>sito</title></head>
<body style="height:4000px"><h1>un sito qualunque</h1></body></html>`;

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

test('il sito non rimette lo zoom dal campo del riquadro con un Invio finto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);

  // L'utente chiede pagina grande in chat.
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  // L'utente apre la modalità rotella con un clic vero sulla rotella.
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();

  // Il sito scrive nel campo e finge l'Invio.
  await page.evaluate(() => {
    const i = document.getElementById('__filo-zoom-percent');
    i.value = '25';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await page.waitForTimeout(400);
  expect(await percentOf(app, page)).toBe(200);
});

test('il sito non rimette lo zoom dal campo del riquadro con un blur finto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  await page.mouse.click(200, 200, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();

  await page.evaluate(() => {
    const i = document.getElementById('__filo-zoom-percent');
    i.value = '25';
    i.dispatchEvent(new FocusEvent('blur'));
  });
  await page.waitForTimeout(400);
  expect(await percentOf(app, page)).toBe(200);
});

test('il sito non rimette lo zoom mettendo il fuoco nel campo e aspettando un clic vero', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  await page.mouse.click(200, 200, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();

  // Il sito non finge nessun evento: scrive e mette il fuoco. Basta che
  // l'utente clicchi da qualche parte (uscendo dalla modalità) perché il
  // numero del sito venga applicato.
  await page.evaluate(() => {
    const i = document.getElementById('__filo-zoom-percent');
    i.value = '25';
    i.focus();
  });
  await page.mouse.click(300, 300);
  await page.waitForTimeout(400);
  expect(await percentOf(app, page)).toBe(200);
});

test('il sito non può impedire i tasti di zoom dell\'utente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('h1').click();

  // Controllo: senza il sito di mezzo il tasto zooma.
  await page.keyboard.press('Control+=');
  await expect.poll(async () => percentOf(app, page)).toBeGreaterThan(100);
  await page.keyboard.press('Control+0');
  await expect.poll(async () => percentOf(app, page)).toBe(100);

  // Il sito si mette davanti a tutti sulla finestra e ferma l'evento.
  await page.evaluate(() => {
    window.addEventListener('keydown', (e) => { e.stopImmediatePropagation(); }, true);
    window.addEventListener('wheel', (e) => { e.stopImmediatePropagation(); }, { capture: true });
    window.addEventListener('mousedown', (e) => { e.stopImmediatePropagation(); }, true);
  });
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(500);
  expect(await percentOf(app, page)).toBeGreaterThan(100);
});
