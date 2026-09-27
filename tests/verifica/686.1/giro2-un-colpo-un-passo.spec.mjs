// #686.1 — giro 2: uno scatto di Ctrl+rotella vale un passo solo, sulla pagina e
// dentro un riquadro. I gesti passano da sendInputEvent, la strada degli eventi
// veri del sistema (lì Chromium segnala anche il Ctrl+rotella già preso).

import { test, expect } from '../../fixtures/electron.mjs';

async function suScheda(app, page, fn, arg) {
  const url = await page.evaluate(() => location.href);
  return app.evaluate(({ webContents }, { u, src, arg }) => {
    const f = new Function('wc', 'arg', src);
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return f(wc, arg);
    }
    return null;
  }, { u: url, src: fn, arg });
}
const percentOf = async (app, page) => {
  const f = await suScheda(app, page, 'return wc.getZoomFactor();');
  return f == null ? null : Math.round(f * 100);
};
const manda = (app, page, eventi) => suScheda(app, page, 'for (const ev of arg) wc.sendInputEvent(ev);', eventi);

const scatto = (verso) => ({ type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 120 * verso, wheelTicksY: verso, canScroll: true, modifiers: ['control'] });
const tasto = (keyCode) => [
  { type: 'keyDown', keyCode, modifiers: ['control'] },
  { type: 'keyUp', keyCode, modifiers: ['control'] },
];

const interno = (s) => s.html(`<!doctype html><html><body style="margin:0;height:3000px">contenuto</body></html>`).replace('127.0.0.1', 'localhost');
const casi = {
  pagina: () => `<!doctype html><html><body style="margin:0;height:3000px"><p>un sito qualunque</p></body></html>`,
  riquadro: (s) => `<!doctype html><html><body style="margin:0"><iframe src="${interno(s)}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`,
};

for (const [nome, html] of Object.entries(casi)) {
  test(`uno scatto di Ctrl+rotella (${nome}) zooma di un passo, non di due`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, html(testServer));
    await page.waitForTimeout(800);
    await page.mouse.click(300, 300);
    await manda(app, page, tasto('='));
    await expect.poll(async () => percentOf(app, page)).toBe(110);
    await manda(app, page, tasto('0'));
    await expect.poll(async () => percentOf(app, page)).toBe(100);

    await manda(app, page, [scatto(1)]);
    await page.waitForTimeout(700);
    const su = await percentOf(app, page);
    expect(su, 'uno scatto in su ingrandisce').toBeGreaterThan(100);
    expect(su, 'uno scatto in su vale quanto Ctrl+ (110%), non il doppio').toBeLessThanOrEqual(115);

    await manda(app, page, tasto('0'));
    await expect.poll(async () => percentOf(app, page)).toBe(100);
    await manda(app, page, [scatto(-1)]);
    await page.waitForTimeout(700);
    const giu = await percentOf(app, page);
    expect(giu, 'uno scatto in giù rimpicciolisce').toBeLessThan(100);
    expect(giu, 'uno scatto in giù vale quanto Ctrl- (90%), non il doppio').toBeGreaterThanOrEqual(86);
  });
}
