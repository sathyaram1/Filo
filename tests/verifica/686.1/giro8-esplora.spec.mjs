// #686.1 giro 8 — esplorazione: riquadri incorporati dove il preload potrebbe non arrivare.

import { test, expect } from '../../fixtures/electron.mjs';

async function wcDi(app, page) { return page.evaluate(() => location.href); }

async function percentOf(app, page) {
  const url = await wcDi(app, page);
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

async function manda(app, page, eventi) {
  const url = await wcDi(app, page);
  await app.evaluate(({ webContents }, { u, eventi }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      for (const ev of eventi) wc.sendInputEvent(ev);
    }
  }, { u: url, eventi });
}
const tasto = (keyCode) => [
  { type: 'keyDown', keyCode, modifiers: ['control'] },
  { type: 'keyUp', keyCode, modifiers: ['control'] },
];
const colpo = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 120, wheelTicksY: 1, canScroll: true, modifiers: ['control'] };
const pizzico = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 4, canScroll: true, hasPreciseScrollingDeltas: true, modifiers: ['control'] };

const DENTRO = '<!doctype html><html><body style="margin:0;height:3000px"><h2 id=c>il messaggio</h2><p>testo della mail</p></body></html>';

const CASI = [
  ['sandbox vuoto (srcdoc)', (s) => `<iframe id=f sandbox srcdoc="${DENTRO.replace(/"/g, '&quot;')}" style="border:0;width:100vw;height:100vh;display:block"></iframe>`],
  ['sandbox allow-same-origin (srcdoc)', (s) => `<iframe id=f sandbox="allow-same-origin" srcdoc="${DENTRO.replace(/"/g, '&quot;')}" style="border:0;width:100vw;height:100vh;display:block"></iframe>`],
  ['sandbox allow-scripts, altro sito', (s) => `<iframe id=f sandbox="allow-scripts" src="${s}" style="border:0;width:100vw;height:100vh;display:block"></iframe>`],
  ['object html', (s) => `<object id=f data="${s}" type="text/html" style="border:0;width:100vw;height:100vh;display:block"></object>`],
];

for (const [nome, html] of CASI) {
  test(`esplora ${nome}`, async ({ app, openTab, testServer }) => {
    const src = testServer.html(DENTRO).replace('127.0.0.1', 'localhost');
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">${html(src)}</body></html>`);
    await page.waitForTimeout(1500);
    await page.mouse.click(300, 300);
    await page.waitForTimeout(200);
    const esiti = {};

    await manda(app, page, tasto('='));
    await page.waitForTimeout(500);
    esiti.tasto = await percentOf(app, page);
    await manda(app, page, tasto('0'));
    await page.waitForTimeout(400);

    await manda(app, page, [colpo]);
    await page.waitForTimeout(600);
    esiti.colpo = await percentOf(app, page);
    await manda(app, page, tasto('0'));
    await page.waitForTimeout(400);

    for (let i = 0; i < 10; i++) { await manda(app, page, [pizzico]); await page.waitForTimeout(30); }
    await page.waitForTimeout(600);
    esiti.pizzico = await percentOf(app, page);
    await manda(app, page, tasto('0'));
    await page.waitForTimeout(400);

    await page.mouse.move(300, 300);
    await page.mouse.click(300, 300, { button: 'middle' });
    await page.waitForTimeout(600);
    esiti.badge = await page.locator('#__filo-zoom-badge').count();
    if (esiti.badge) {
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(500);
      esiti.rotellaInModalita = await percentOf(app, page);
    }
    console.log('ESITI', nome, JSON.stringify(esiti));
    expect.soft(esiti.tasto, 'tasto').toBe(110);
    expect.soft(esiti.colpo, 'colpo').toBeGreaterThan(100);
    expect.soft(esiti.colpo, 'colpo').toBeLessThan(130);
    expect.soft(esiti.pizzico, 'pizzico').not.toBe(100);
    expect.soft(esiti.badge, 'rotella premuta').toBe(1);
  });
}
