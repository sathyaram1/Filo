// #686 giro 2 — chi comanda lo zoom è l'utente, non il sito.
// Giro 1 aveva trovato che una pagina poteva rimettersi la misura che voleva.
// Qui si ri-provano quelle porte e se ne cercano altre della stessa famiglia:
// un sito che non vuole essere ingrandito non deve poter vincere.

import { test, expect } from './../../fixtures/electron.mjs';

const OSTILE = `<!doctype html><html><head><meta charset="utf-8"><title>ostile</title></head>
<body><h1>pagina che non vuole essere ingrandita</h1><p id="p">testo</p></body></html>`;

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

test('il sito non si dichiara padrone dello zoom', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, OSTILE);
  await page.evaluate(() => { document.documentElement.dataset.filoOwnZoom = '1'; });
  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  expect(r.executed).toBe(true);
  expect(r.output.percentuale).toBe(200);
  await expect.poll(async () => percentOf(app, page)).toBe(200);
});

test('il sito non rimette la pagina a dimensione reale con un evento', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, OSTILE);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  await page.evaluate(() => {
    for (const n of ['filo:zoom-reset', 'filo:zoom-out', 'filo:zoom-set']) {
      document.documentElement.dataset.filoZoomTarget = '100';
      document.dispatchEvent(new Event(n));
      document.dispatchEvent(new CustomEvent(n, { bubbles: true }));
    }
  });
  await page.waitForTimeout(400);
  expect(await percentOf(app, page)).toBe(200);
});

test('il sito non trova la leva dello zoom nel proprio mondo', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, OSTILE);
  const visto = await page.evaluate(() => ({
    zoomApi: typeof window.SN_ZOOM_PAGINA,
    aritmetica: typeof window.SN_ZOOM,
  }));
  expect(visto.zoomApi).toBe('undefined');
  expect(visto.aritmetica).toBe('undefined');
});

test('il sito non rimette la pagina a dimensione reale fingendo Ctrl+0', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, OSTILE);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: '0', code: 'Digit0', ctrlKey: true, bubbles: true, cancelable: true,
    }));
  });
  await page.waitForTimeout(400);
  expect(await percentOf(app, page)).toBe(200);
});

test('il sito non rimpicciolisce la pagina fingendo Ctrl+rotella', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, OSTILE);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) {
      document.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true,
      }));
    }
  });
  await page.waitForTimeout(400);
  expect(await percentOf(app, page)).toBe(200);
});

test('il sito non apre da sé la modalità zoom della rotella', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, OSTILE);
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300);
  expect(await page.locator('#__filo-zoom-badge').count()).toBe(0);
});

test('i tasti veri dell\'utente continuano a zoomare', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, OSTILE);
  await page.locator('#p').click();
  await page.keyboard.press('Control+Equal');
  await expect.poll(async () => percentOf(app, page)).toBeGreaterThan(100);
  await page.keyboard.press('Control+0');
  await expect.poll(async () => percentOf(app, page)).toBe(100);
});
