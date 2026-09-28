// #686.1 — giro 5, rilievo 1: il riquadro con la percentuale vive nel documento
// della pagina, e dove la pagina non lo sa disegnare o toccare la rotella premuta
// apre una modalità che non si vede: pagina a frame, immagine SVG, dialogo modale.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function percentOf(app, url) {
  return app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return Math.round(wc.getZoomFactor() * 100);
    }
    return null;
  }, url);
}

async function manda(app, url, eventi) {
  await app.evaluate(({ webContents }, { u, eventi }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      for (const ev of eventi) wc.sendInputEvent(ev);
    }
  }, { u: url, eventi });
}

const clic = (x, y, button = 'left') => [
  { type: 'mouseDown', x, y, button, clickCount: 1 },
  { type: 'mouseUp', x, y, button, clickCount: 1 },
];
const cifra = (k) => [{ type: 'keyDown', keyCode: k }, { type: 'char', keyCode: k }, { type: 'keyUp', keyCode: k }];

test('pagina a frame: la rotella premuta su un frame mostra il riquadro con la percentuale', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><html><body style="margin:0;height:3000px"><h2>indice</h2></body></html>');
  const b = testServer.html('<!doctype html><html><body style="margin:0;height:3000px"><h2>contenuto</h2></body></html>');
  const url = testServer.html(`<html><frameset cols="70%,*"><frame src="${a}"><frame src="${b}"></frameset></html>`);
  const page = await openTab(url);
  await page.waitForTimeout(1500);
  await manda(app, url, clic(300, 300));
  await manda(app, url, clic(300, 300, 'middle'));
  await expect(page.locator('#__filo-zoom-badge'), 'la modalità si apre ma il riquadro non si vede').toBeVisible({ timeout: 4000 });
});

test('immagine SVG aperta in una scheda: la rotella premuta mostra il riquadro con la percentuale', async ({ app, openTab }) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="3000"><rect x="10" y="10" width="400" height="300" fill="#c96"/></svg>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/logo.svg`;
  try {
    const page = await openTab(url);
    await page.waitForTimeout(1500);
    await manda(app, url, clic(300, 300, 'middle'));
    await expect(page.locator('#__filo-zoom-badge'), 'la modalità si apre ma il riquadro non si vede').toBeVisible({ timeout: 4000 });
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});

test('con un dialogo modale aperto, il numero battuto nel riquadro vale', async ({ app, openTab, testServer }) => {
  const url = testServer.html(`<!doctype html><html><body style="height:4000px"><h1>sito</h1>
    <dialog id="d"><p>Accetti i cookie?</p><button>Accetta</button></dialog>
    <script>document.getElementById('d').showModal();</script></body></html>`);
  const page = await openTab(url);
  await page.waitForTimeout(1500);
  await manda(app, url, clic(150, 600, 'middle'));
  await expect(page.locator('#__filo-zoom-badge')).toBeAttached({ timeout: 4000 });
  const r = await page.locator('#__filo-zoom-percent').boundingBox();
  await manda(app, url, clic(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)));
  await page.waitForTimeout(300);
  for (const k of ['1', '5', '0']) await manda(app, url, cifra(k));
  await manda(app, url, [{ type: 'keyDown', keyCode: 'Return' }, { type: 'keyUp', keyCode: 'Return' }]);
  await expect.poll(async () => percentOf(app, url), { timeout: 4000, message: 'il campo del riquadro non si raggiunge sotto il dialogo' }).toBe(150);
});
