// esplorazione giro 5 (si cancella)
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function server() {
  const routes = new Map();
  const s = createServer((req, res) => {
    const r = routes.get(req.url.split('?')[0]);
    if (!r) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, r.headers);
    res.end(r.body);
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const port = s.address().port;
  return {
    add(path, body, headers = { 'Content-Type': 'text/html; charset=utf-8' }) { routes.set(path, { body, headers }); return `http://127.0.0.1:${port}${path}`; },
    close: () => new Promise((ok) => s.close(ok)),
  };
}

const wcOf = (u) => `(${(u)})`;
async function percent(app, prefix) {
  return app.evaluate(({ webContents }, p) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here.startsWith(p)) return Math.round(wc.getZoomFactor() * 100);
    }
    return null;
  }, prefix);
}
async function manda(app, prefix, eventi) {
  await app.evaluate(({ webContents }, { p, eventi }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (!here.startsWith(p)) continue;
      for (const ev of eventi) wc.sendInputEvent(ev);
    }
  }, { p: prefix, eventi });
}
async function js(app, prefix, code) {
  return app.evaluate(async ({ webContents }, { p, code }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (!here.startsWith(p)) continue;
      try { return await wc.executeJavaScript(code, true); } catch (e) { return 'ERR ' + e.message; }
    }
    return 'NOWC';
  }, { p: prefix, code });
}
const tasto = (keyCode) => [
  { type: 'keyDown', keyCode, modifiers: ['control'] },
  { type: 'keyUp', keyCode, modifiers: ['control'] },
];
const colpo = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 120, wheelTicksY: 1, canScroll: true, modifiers: ['control'] };
const pizzico = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 4, canScroll: true, hasPreciseScrollingDeltas: true, modifiers: ['control'] };
const medio = [
  { type: 'mouseDown', x: 300, y: 300, button: 'middle', clickCount: 1 },
  { type: 'mouseUp', x: 300, y: 300, button: 'middle', clickCount: 1 },
];
const clic = [
  { type: 'mouseDown', x: 300, y: 300, button: 'left', clickCount: 1 },
  { type: 'mouseUp', x: 300, y: 300, button: 'left', clickCount: 1 },
];
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

async function misura(app, prefix, nome) {
  const out = { nome };
  await manda(app, prefix, clic); await attendi(300);
  await manda(app, prefix, tasto('=')); await attendi(700);
  out.tastoPiu = await percent(app, prefix);
  await manda(app, prefix, tasto('0')); await attendi(500);
  out.dopoZero = await percent(app, prefix);
  await manda(app, prefix, [colpo]); await attendi(800);
  out.colpo = await percent(app, prefix);
  await manda(app, prefix, tasto('0')); await attendi(500);
  for (let i = 0; i < 10; i++) { await manda(app, prefix, [pizzico]); await attendi(30); }
  await attendi(500);
  out.pizzico = await percent(app, prefix);
  await manda(app, prefix, tasto('0')); await attendi(500);
  await manda(app, prefix, medio); await attendi(700);
  out.medio = await js(app, prefix, `(() => { const b = document.getElementById('__filo-zoom-badge'); const r = b && b.getBoundingClientRect(); return JSON.stringify({ modo: document.documentElement.dataset.filoZoomMode || '', badge: !!b, w: r ? r.width : 0, h: r ? r.height : 0, parent: b && b.parentNode && b.parentNode.nodeName }); })()`);
  console.log('ESPLORA', JSON.stringify(out));
  return out;
}

test('csp sandbox top-level', async ({ app, openTab }) => {
  const s = await server();
  const u = s.add('/csp', '<!doctype html><html><body style="height:4000px"><h1>sandbox csp</h1></body></html>', { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
  await openTab(u); await attendi(1500);
  await misura(app, u, 'csp-sandbox');
  await s.close();
});

test('raw text con csp sandbox', async ({ app, openTab }) => {
  const s = await server();
  const u = s.add('/raw.txt', 'riga\n'.repeat(400), { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
  await openTab(u); await attendi(1500);
  await misura(app, u, 'raw-text-sandbox');
  await s.close();
});

test('immagine top-level', async ({ app, openTab }) => {
  const s = await server();
  const u = s.add('/img.png', PNG, { 'Content-Type': 'image/png' });
  await openTab(u); await attendi(1500);
  await misura(app, u, 'immagine');
  await s.close();
});

test('iframe sandbox senza script, altro sito', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;height:3000px"><h2>email</h2></body></html>').replace('127.0.0.1', 'localhost');
  const u = testServer.html(`<!doctype html><html><body style="margin:0"><iframe sandbox src="${dentro}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
  await openTab(u); await attendi(1500);
  await misura(app, u, 'iframe-sandbox-altro-sito');
});

test('iframe sandbox allow-same-origin srcdoc', async ({ app, openTab, testServer }) => {
  const u = testServer.html(`<!doctype html><html><body style="margin:0"><iframe sandbox="allow-same-origin" srcdoc="<body style='margin:0;height:3000px'><h2>email</h2></body>" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
  await openTab(u); await attendi(1500);
  await misura(app, u, 'iframe-sandbox-same-origin-srcdoc');
});

test('iframe sandbox allow-same-origin src stesso sito', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;height:3000px"><h2>email</h2></body></html>');
  const u = testServer.html(`<!doctype html><html><body style="margin:0"><iframe sandbox="allow-same-origin" src="${dentro}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
  await openTab(u); await attendi(1500);
  await misura(app, u, 'iframe-sandbox-same-origin-src');
});

test('frameset', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><html><body style="margin:0;height:3000px"><h2>sinistra</h2></body></html>');
  const b = testServer.html('<!doctype html><html><body style="margin:0;height:3000px"><h2>destra</h2></body></html>');
  const u = testServer.html(`<html><frameset cols="100%,*"><frame src="${a}"><frame src="${b}"></frameset></html>`);
  await openTab(u); await attendi(1500);
  await misura(app, u, 'frameset');
});

test('javascript url riscrive', async ({ app, openTab, testServer }) => {
  const u = testServer.html('<!doctype html><html><body style="height:4000px"><h1>x</h1></body></html>');
  const page = await openTab(u); await attendi(1200);
  await page.evaluate(() => { location.href = "javascript:'<!doctype html><html><body style=\"height:4000px\"><h1>js url</h1></body></html>'"; });
  await attendi(800);
  console.log('ESPLORA jsurl body', await js(app, u, 'document.body && document.body.innerHTML'));
  await misura(app, u, 'javascript-url');
});

test('incolla del sito nel campo', async ({ app, openTab, testServer }) => {
  const u = testServer.html('<!doctype html><html><body style="height:4000px"><h1>x</h1></body></html>');
  const page = await openTab(u); await attendi(1200);
  await manda(app, u, medio); await attendi(500);
  await page.locator('#__filo-zoom-percent').click();
  const r = await page.evaluate(async () => {
    const i = document.getElementById('__filo-zoom-percent');
    let copia = null, incolla = null;
    document.addEventListener('copy', (e) => { e.clipboardData.setData('text/plain', '25'); e.preventDefault(); }, { once: true });
    try { copia = document.execCommand('copy'); } catch (e) { copia = 'ERR ' + e.message; }
    i.focus();
    try { incolla = document.execCommand('paste'); } catch (e) { incolla = 'ERR ' + e.message; }
    return { copia, incolla, value: i.value };
  });
  console.log('ESPLORA paste', JSON.stringify(r));
  await page.mouse.click(300, 500);
  await attendi(500);
  console.log('ESPLORA paste dopo', await percent(app, u));
});
