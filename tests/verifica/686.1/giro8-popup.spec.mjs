// #686.1 giro 8 — esplorazione: una finestra aperta dal sito e scritta da lui.

import { test, expect } from '../../fixtures/electron.mjs';

test('esplora: finestra aperta e scritta dal sito', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><button id=b onclick="const w = window.open(\'\'); w.document.write(\'<!doctype html><html><body style=height:3000px><h1 id=x>stampa</h1></body></html>\'); w.document.close();">apri</button></body></html>');
  await page.click('#b');
  await page.waitForTimeout(2000);
  const info = await app.evaluate(async ({ webContents }) => {
    const out = [];
    for (const wc of webContents.getAllWebContents()) {
      let u = ''; try { u = wc.getURL(); } catch (_) {}
      let t = ''; try { t = await wc.executeJavaScript('document.body ? document.body.innerText.slice(0,40) : ""'); } catch (_) {}
      out.push({ id: wc.id, u, t, type: wc.getType() });
    }
    return out;
  });
  console.log('WC', JSON.stringify(info));
  const id = (info.find((x) => x.t.includes('stampa')) || {}).id;
  if (!id) return;
  const r = await app.evaluate(async ({ webContents }, id) => {
    const wc = webContents.fromId(id);
    const z = () => Math.round(wc.getZoomFactor() * 100);
    const res = {};
    wc.focus();
    wc.sendInputEvent({ type: 'mouseDown', x: 100, y: 200, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 100, y: 200, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 200));
    wc.sendInputEvent({ type: 'keyDown', keyCode: '=', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: '=', modifiers: ['control'] });
    await new Promise((r) => setTimeout(r, 500));
    res.tasto = z();
    wc.sendInputEvent({ type: 'keyDown', keyCode: '0', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: '0', modifiers: ['control'] });
    await new Promise((r) => setTimeout(r, 400));
    wc.sendInputEvent({ type: 'mouseWheel', x: 100, y: 200, deltaX: 0, deltaY: 120, wheelTicksY: 1, canScroll: true, modifiers: ['control'] });
    await new Promise((r) => setTimeout(r, 600));
    res.colpo = z();
    wc.sendInputEvent({ type: 'keyDown', keyCode: '0', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: '0', modifiers: ['control'] });
    await new Promise((r) => setTimeout(r, 400));
    wc.sendInputEvent({ type: 'mouseDown', x: 100, y: 200, button: 'middle', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 100, y: 200, button: 'middle', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 600));
    res.badge = await wc.executeJavaScript('!!document.getElementById("__filo-zoom-badge")');
    res.filo = await wc.executeJavaScript('document.documentElement.outerHTML.length');
    return res;
  }, id);
  console.log('ESITI', JSON.stringify(r));
});
