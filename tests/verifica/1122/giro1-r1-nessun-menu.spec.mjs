// #1122 giro 1 — rilievo 1: quando il menu di Filo non parte senza un guasto, il tasto destro non mostra niente.

import http from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const finestre = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((x) => !x.isDestroyed() && x.isVisible() && x.webContents.getURL().startsWith('data:text/html')).length);

test('r1 tasto destro mentre la pagina carica ancora: compare un menu', async ({ app, shell }) => {
  let rilascia;
  const lento = new Promise((r) => { rilascia = r; });
  const srv = http.createServer(async (req, res) => {
    if (req.url === '/lento.js') { await lento; res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(''); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><body style="padding:40px"><p id="p" style="font-size:30px">Testo che compare subito</p><script src="/lento.js"></script></body>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/`;
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith(url)); return !!page; }, { timeout: 10000 }).toBe(true);
    await page.locator('#p').waitFor();
    await page.locator('#p').click({ button: 'right' });
    await page.waitForTimeout(1500);
    const menuPagina = await page.locator('.sn-menu').count();
    const riserva = await finestre(app);
    expect(menuPagina + riserva, 'nessun menu durante il caricamento').toBeGreaterThan(0);
  } finally { rilascia(); srv.close(); }
});

test('r1 Shift + tasto destro: compare il menu del browser', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<body style="padding:40px"><p id="p">Testo di prova</p></body>');
  await page.keyboard.down('Shift');
  await page.locator('#p').click({ button: 'right' });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(1500);
  expect((await page.locator('.sn-menu').count()) + (await finestre(app)), 'con Shift non compare nessun menu').toBeGreaterThan(0);
});
