// #686.1 — giro 1: i gesti dello zoom dove il preload non arriva per primo: il
// documento riscritto con un ascoltatore del sito messo davanti (resta aperto,
// vedi patterns/lo-zoom-lo-tiene-filo-non-la-pagina.md). Il riquadro riempito
// dalla pagina è chiuso e sta in tests/zoom-fuori-dalla-pagina.spec.mjs. Riferimento:
// su una pagina normale un colpo di rotella con Ctrl vale circa un passo, il
// pizzico del trackpad scorre fluido, la rotella premuta apre il riquadro.
// I gesti passano da sendInputEvent, la strada degli eventi veri del sistema.

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
const medio = [
  { type: 'mouseDown', x: 300, y: 300, button: 'middle', clickCount: 1 },
  { type: 'mouseUp', x: 300, y: 300, button: 'middle', clickCount: 1 },
];

async function gesti(app, page) {
  await manda(app, page, tasto('='));
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(110);
  await manda(app, page, tasto('0'));
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(100);

  for (let i = 0; i < 10; i++) { await manda(app, page, [pizzico]); await page.waitForTimeout(30); }
  await page.waitForTimeout(400);
  const dopo = await percentOf(app, page);
  expect.soft(dopo, 'il pizzico del trackpad non muove lo zoom').not.toBe(100);
  expect.soft(Math.abs(dopo - 100), 'il pizzico del trackpad salta invece di scorrere').toBeLessThan(15);
  await manda(app, page, tasto('0'));
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(100);

  await manda(app, page, [colpo]);
  await page.waitForTimeout(500);
  const unColpo = await percentOf(app, page);
  expect.soft(unColpo, 'un colpo di rotella con Ctrl non zooma').toBeGreaterThan(100);
  expect.soft(unColpo, 'un colpo di rotella con Ctrl salta più di un passo').toBeLessThan(130);
  await manda(app, page, tasto('0'));
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(100);

  await manda(app, page, medio);
  await expect.soft(page.locator('#__filo-zoom-badge'), 'la rotella premuta non apre il riquadro dello zoom').toBeVisible({ timeout: 4000 });
}

test('documento riscritto con un ascoltatore del sito messo davanti a Filo: i gesti restano dell\'utente', async ({ app, openTab, testServer }) => {
  test.fail(true, '#686.1: Il pizzico del trackpad e la rotella premuta dipendono ancora da un ascoltatore dentro la pagina');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body><h1>x</h1></body></html>`);
  await page.evaluate(() => {
    document.open();
    document.write('<!doctype html><html><body style="height:4000px"><scr' + 'ipt>for (const t of ["wheel","mousedown"]) window.addEventListener(t, e => e.stopImmediatePropagation(), { capture: true, passive: false });</scr' + 'ipt><h1>riscritta</h1></body></html>');
    document.close();
  });
  await page.mouse.click(300, 300);
  await gesti(app, page);
});
