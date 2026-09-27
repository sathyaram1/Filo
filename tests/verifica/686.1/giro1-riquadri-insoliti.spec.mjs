// #686.1 — giro 1: i gesti dello zoom dove il preload non c'è o non arriva per
// primo: il riquadro che la pagina riempie da sé (editor di testo ricco), il
// documento riscritto con un ascoltatore del sito messo davanti. Riferimento:
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

test('riquadro riempito dalla pagina (editor di testo ricco): dopo un clic dentro i gesti rispondono', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <iframe id="f" style="border:0;width:100vw;height:100vh;display:block"></iframe>
    <script>
      const d = document.getElementById('f').contentDocument;
      d.open(); d.write('<!doctype html><html><body contenteditable style="margin:0;height:3000px"><h2>scrivi qui</h2></body></html>'); d.close();
    </script></body></html>`);
  await page.mouse.click(300, 300);
  await gesti(app, page);
});

test('riquadro srcdoc e riquadri uno dentro l\'altro: i gesti rispondono', async ({ app, openTab, testServer }) => {
  const interno = testServer.html(`<!doctype html><html><body style="margin:0;height:3000px"><h2 style="margin:0">contenuto</h2></body></html>`);
  const medioSito = testServer.html(`<!doctype html><html><body style="margin:0">
    <iframe src="${interno}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`).replace('127.0.0.1', 'localhost');
  for (const html of [
    `<!doctype html><html><body style="margin:0"><iframe srcdoc="<div style='height:3000px'>contenuto</div>" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`,
    `<!doctype html><html><body style="margin:0"><iframe src="${medioSito}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`,
  ]) {
    const page = await testServer.openReady(openTab, html);
    await page.waitForTimeout(1200);
    await page.mouse.click(300, 300);
    await gesti(app, page);
  }
});

test('documento riscritto con un ascoltatore del sito messo davanti a Filo: i gesti restano dell\'utente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body><h1>x</h1></body></html>`);
  await page.evaluate(() => {
    document.open();
    document.write('<!doctype html><html><body style="height:4000px"><scr' + 'ipt>for (const t of ["wheel","mousedown"]) window.addEventListener(t, e => e.stopImmediatePropagation(), { capture: true, passive: false });</scr' + 'ipt><h1>riscritta</h1></body></html>');
    document.close();
  });
  await page.mouse.click(300, 300);
  await gesti(app, page);
});
