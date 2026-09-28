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
      if (here.startsWith(p)) return Math.round(wc.getZoomFactor() * 100) + '@' + here;
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

async function iso(app, prefix, code) {
  return app.evaluate(async ({ webContents }, { p, code }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (!here.startsWith(p)) continue;
      try { return await wc.executeJavaScriptInIsolatedWorld(4242, [{ code }], true); } catch (e) { return 'ERR ' + e.message; }
    }
    return 'NOWC';
  }, { p: prefix, code });
}

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
  out.medio = await iso(app, prefix, `(() => { const b = document.getElementById('__filo-zoom-badge'); const r = b && b.getBoundingClientRect(); return JSON.stringify({ modo: document.documentElement.dataset.filoZoomMode || '', badge: !!b, w: r ? r.width : 0, h: r ? r.height : 0, parent: b && b.parentNode && b.parentNode.nodeName }); })()`);
  console.log('ESPLORA', JSON.stringify(out));
  return out;
}




const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

test('il sito clicca da sé la voce del tasto destro che rimette lo zoom', async ({ app, openTab, testServer }) => {
  const u = testServer.html(`<!doctype html><html><body style="height:4000px"><h1 id="t">sito</h1><p>testo da leggere</p>
    <script>
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('.sn-menu *')) {
          if (!window.__fatto && /Dimensione reale/.test(el.textContent || '') && el.children.length <= 3 && el.click) { window.__fatto = el.className || el.tagName; el.click(); }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    </script></body></html>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1 id="t">sito</h1><p>testo da leggere</p>
    <script>
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('.sn-menu *')) {
          if (!window.__fatto && /Dimensione reale/.test(el.textContent || '') && el.children.length <= 3 && el.click) { window.__fatto = el.className || el.tagName; el.click(); }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    </script></body></html>`);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => page.evaluate(() => Math.round(window.devicePixelRatio * 100))).toBeGreaterThan(150);
  const prima = await page.evaluate(() => location.href);
  console.log('ESPLORA menu prima', await percent(app, prima), await page.evaluate(() => window.devicePixelRatio));
  await page.locator('p').click({ button: 'right' });
  await page.waitForTimeout(1500);
  console.log('ESPLORA menu dopo tasto destro', await percent(app, prima), await page.evaluate(() => window.devicePixelRatio), await page.evaluate(() => String(window.__fatto || '')), await page.locator('.sn-menu').count());
});
