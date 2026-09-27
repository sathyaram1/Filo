// #686.1 — giro 4: nel riquadro che la pagina riempie da sé (editor di testo
// ricco) il sito mette un suo ascoltatore sulla finestra del riquadro prima che
// Filo lo agganci: pizzico e rotella premuta non devono diventare del sito.
// Stessa famiglia del documento riscritto (giro 1), senza nessuna riscrittura.

import { test, expect } from '../../fixtures/electron.mjs';

async function percentOf(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = ''; try { here = wc.getURL(); } catch (_) {}
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
      let here = ''; try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      for (const ev of eventi) wc.sendInputEvent(ev);
    }
  }, { u: url, eventi });
}
const pizzico = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 4, canScroll: true, hasPreciseScrollingDeltas: true, modifiers: ['control'] };
const medio = [
  { type: 'mouseDown', x: 300, y: 300, button: 'middle', clickCount: 1 },
  { type: 'mouseUp', x: 300, y: 300, button: 'middle', clickCount: 1 },
];
const PIENO = 'border:0;width:100vw;height:100vh;display:block';

test('editor in un riquadro riempito dalla pagina, col sito che ascolta per primo: pizzico e rotella premuta restano dell\'utente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><iframe id=f style="${PIENO}"></iframe><script>
    const d = document.getElementById('f').contentDocument; d.open(); d.write('<body contenteditable style="margin:0;height:3000px">scrivi qui</body>'); d.close();
    for (const t of ['wheel', 'mousedown', 'pointerdown']) document.getElementById('f').contentWindow.addEventListener(t, e => e.stopImmediatePropagation(), { capture: true, passive: false });
  </script></body></html>`);
  await page.waitForTimeout(800);
  await page.mouse.move(310, 310);
  await page.mouse.click(300, 300);

  for (let i = 0; i < 10; i++) { await manda(app, page, [pizzico]); await page.waitForTimeout(30); }
  await page.waitForTimeout(400);
  expect.soft(await percentOf(app, page), 'il pizzico del trackpad non muove lo zoom').not.toBe(100);

  await manda(app, page, medio);
  await expect.soft(page.locator('#__filo-zoom-badge'), 'la rotella premuta non apre il riquadro dello zoom').toBeVisible({ timeout: 4000 });
});
