// #686 — giro 4, esplorazione: altre strade per cui il sito riprende lo zoom.

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

test('riquadro aperto: il sito scrive nel campo con execCommand ed esce dal campo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  const info = await page.evaluate(() => {
    const i = document.getElementById('__filo-zoom-percent');
    let trusted = null;
    i.addEventListener('input', (e) => { trusted = e.isTrusted; }, { once: true });
    i.focus();
    i.select();
    const ok = document.execCommand('insertText', false, '25');
    i.blur();
    return { ok, trusted, value: i.value };
  });
  await page.waitForTimeout(400);
  expect(await percentOf(app, page), JSON.stringify(info)).toBe(200);
});

test('document.open spegne i gesti', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => {
    document.open();
    document.write('<!doctype html><html><body style="height:4000px"><h1 id=t>riscritta</h1></body></html>');
    document.close();
  });
  await page.locator('#t').click();
  await page.keyboard.press('Control+=');
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBeGreaterThan(100);
  await page.keyboard.press('Control+0');
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(100);
  await page.mouse.click(200, 300, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
});
