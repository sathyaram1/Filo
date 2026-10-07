// #686.1 giro 10, esplorazione: riquadri incorporati con sandbox (il corpo di una mail nelle webmail).

import { test, expect } from '../../fixtures/electron.mjs';

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
async function manda(app, page, eventi) {
  const url = await page.evaluate(() => location.href);
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
const rotella = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: -120, wheelTicksY: -1, canScroll: true, modifiers: [] };
const medio = [
  { type: 'mouseDown', x: 300, y: 300, button: 'middle', clickCount: 1 },
  { type: 'mouseUp', x: 300, y: 300, button: 'middle', clickCount: 1 },
];

const PIENO = 'border:0;width:100vw;height:100vh;display:block';
const corpo = "<div style='height:3000px;font:20px sans-serif'>Gentile cliente, ecco la fattura</div>";
const casi = {
  'srcdoc con sandbox vuoto': () => `<iframe sandbox srcdoc="${corpo}" style="${PIENO}"></iframe>`,
  'srcdoc con sandbox da webmail': () => `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${corpo}" style="${PIENO}"></iframe>`,
  'srcdoc con sandbox stessa origine senza script': () => `<iframe sandbox="allow-same-origin" srcdoc="${corpo}" style="${PIENO}"></iframe>`,
  'src con sandbox e script': (s) => `<iframe sandbox="allow-scripts" src="${s.html(`<!doctype html><html><body style="margin:0">${corpo}</body></html>`)}" style="${PIENO}"></iframe>`,
  'src con sandbox senza script': (s) => `<iframe sandbox src="${s.html(`<!doctype html><html><body style="margin:0">${corpo}</body></html>`)}" style="${PIENO}"></iframe>`,
};

for (const [nome, html] of Object.entries(casi)) {
  test(`esplora ${nome}`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">${html(testServer)}</body></html>`);
    await page.waitForTimeout(1000);
    await page.mouse.click(300, 300);
    const esiti = {};
    await manda(app, page, tasto('='));
    await page.waitForTimeout(400);
    esiti.tasto = await percentOf(app, page);
    await manda(app, page, tasto('0'));
    await page.waitForTimeout(400);
    await manda(app, page, [colpo]);
    await page.waitForTimeout(600);
    esiti.colpo = await percentOf(app, page);
    await manda(app, page, tasto('0'));
    await page.waitForTimeout(400);
    for (let i = 0; i < 10; i++) { await manda(app, page, [pizzico]); await page.waitForTimeout(30); }
    await page.waitForTimeout(500);
    esiti.pizzico = await percentOf(app, page);
    await manda(app, page, tasto('0'));
    await page.waitForTimeout(400);
    await manda(app, page, medio);
    await page.waitForTimeout(500);
    esiti.badge = await page.locator('#__filo-zoom-badge').count();
    await manda(app, page, [rotella]);
    await page.waitForTimeout(500);
    esiti.rotellaInModalita = await percentOf(app, page);
    console.log(nome, JSON.stringify(esiti));
    expect.soft(esiti.tasto, 'tasto').toBe(110);
    expect.soft(esiti.colpo, 'colpo').toBeGreaterThan(100);
    expect.soft(esiti.colpo, 'colpo').toBeLessThan(120);
    expect.soft(esiti.pizzico, 'pizzico').not.toBe(100);
    expect.soft(esiti.badge, 'badge').toBe(1);
    expect.soft(esiti.rotellaInModalita, 'rotella in modalità').toBeGreaterThan(100);
  });
}
