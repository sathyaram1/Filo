// esplorazione (si cancella): il riquadro nello strato superiore del documento
import { test } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function iso(app, url, code) {
  return app.evaluate(async ({ webContents }, { u, code }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      try { return await wc.executeJavaScriptInIsolatedWorld(4243, [{ code }], true); } catch (e) { return 'ERR ' + e.message; }
    }
    return 'NOWC';
  }, { u: url, code });
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
const METTI = `(() => {
  const d = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  d.setAttribute('popover', 'manual');
  d.textContent = 'zoom 100%';
  Object.assign(d.style, { position: 'fixed', inset: 'auto', top: '12px', right: '12px', left: 'auto', margin: '0', background: 'rgb(200,20,20)', color: '#fff', padding: '6px 10px', border: 'none', width: '200px', height: '30px' });
  const modale = document.querySelector('dialog:modal');
  (modale || document.documentElement).appendChild(d);
  let ok = 'nopopover';
  try { d.showPopover(); ok = 'popover'; } catch (e) { ok = 'ERR ' + e.message; }
  window.__colpito = '';
  d.addEventListener('mousedown', () => { window.__colpito = 'si'; });
  const r = d.getBoundingClientRect();
  return JSON.stringify({ ok, w: r.width, h: r.height, x: r.x, y: r.y, dentroModale: !!modale });
})()`;
const clic = (x, y) => [{ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 }];

for (const caso of ['frameset', 'svg', 'dialog', 'dialog-fuori']) {
  test(caso, async ({ app, openTab, testServer }) => {
    let url; let server;
    if (caso === 'svg') {
      server = createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="3000"><rect x="10" y="10" width="400" height="300" fill="#c96"/></svg>'); });
      await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
      url = `http://127.0.0.1:${server.address().port}/x.svg`;
    } else if (caso === 'frameset') {
      const a = testServer.html('<body style="height:3000px">a</body>');
      url = testServer.html(`<html><frameset cols="70%,*"><frame src="${a}"><frame src="${a}"></frameset></html>`);
    } else {
      url = testServer.html(`<!doctype html><body style="height:3000px"><dialog id=d><p>cookie</p></dialog><script>d.showModal()</script></body>`);
    }
    const page = await openTab(url);
    await page.waitForTimeout(1200);
    const code = caso === 'dialog-fuori' ? METTI.replace("document.querySelector('dialog:modal')", 'null') : METTI;
    console.log('ESPLORA2', caso, await iso(app, url, code));
    await page.screenshot({ path: `tests/.shots/686-1-g5-top-${caso}.png` });
    await manda(app, url, clic(1160, 27));
    await page.waitForTimeout(300);
    console.log('ESPLORA2', caso, 'colpito', await iso(app, url, 'String(window.__colpito)'));
    if (server) await new Promise((ok) => server.close(ok));
  });
}
