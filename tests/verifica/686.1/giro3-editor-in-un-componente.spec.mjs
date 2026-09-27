// #686.1 — giro 3: il riquadro che la pagina riempie da sé (editor di testo
// ricco) quando sta dentro un componente della pagina (shadow DOM): pizzico del
// trackpad e rotella premuta devono rispondere come nel riquadro semplice.
// Una pagina sola per test: openTab restituisce la prima scheda con lo stesso host.

import { test, expect } from '../../fixtures/electron.mjs';

async function suScheda(app, page, src, arg) {
  const url = await page.evaluate(() => location.href);
  return app.evaluate(({ webContents }, { u, src, arg }) => {
    const f = new Function('wc', 'arg', src);
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return f(wc, arg);
    }
    return null;
  }, { u: url, src, arg });
}
const percentOf = async (app, page) => {
  const f = await suScheda(app, page, 'return wc.getZoomFactor();');
  return f == null ? null : Math.round(f * 100);
};
const manda = (app, page, eventi) => suScheda(app, page, 'for (const ev of arg) wc.sendInputEvent(ev);', eventi);
const pizzico = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: -4, canScroll: true, hasPreciseScrollingDeltas: true, modifiers: ['control'] };
const medio = [
  { type: 'mouseDown', x: 300, y: 300, button: 'middle', clickCount: 1 },
  { type: 'mouseUp', x: 300, y: 300, button: 'middle', clickCount: 1 },
];

for (const modo of ['open', 'closed']) {
  test(`editor di testo ricco dentro un componente (${modo}): pizzico e rotella premuta rispondono`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><div id="h"></div><script>
      const r = document.getElementById('h').attachShadow({ mode: '${modo}' });
      const f = document.createElement('iframe');
      f.style.cssText = 'border:0;width:100vw;height:100vh;display:block';
      r.appendChild(f);
      const d = f.contentDocument; d.open();
      d.write('<body contenteditable style="margin:0;height:3000px">scrivi qui</body>'); d.close();
    </script></body></html>`);
    await page.waitForTimeout(800);
    await page.mouse.move(300, 300);
    await page.mouse.click(300, 300);

    for (let i = 0; i < 10; i++) { await manda(app, page, [pizzico]); await page.waitForTimeout(40); }
    await expect.poll(async () => percentOf(app, page), { message: 'il pizzico del trackpad non zooma', timeout: 3000 }).not.toBe(100);

    await manda(app, page, medio);
    await expect(page.locator('#__filo-zoom-badge'), 'la rotella premuta non apre il riquadro dello zoom').toBeVisible({ timeout: 3000 });
  });
}
