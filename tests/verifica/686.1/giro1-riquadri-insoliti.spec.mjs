// #686.1 — giro 1: i riquadri che non sono una pagina caricata da un indirizzo
// (scritti dalla pagina stessa, come gli editor di testo ricco; srcdoc; uno
// dentro l'altro). Dopo un clic sul contenuto lo zoom deve rispondere come fuori.

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

async function premi(app, page, keyCode) {
  const url = await page.evaluate(() => location.href);
  await app.evaluate(({ webContents }, { u, keyCode }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] });
    }
  }, { u: url, keyCode });
}

const CASI = {
  // Un editor di testo ricco: riquadro vuoto riempito dalla pagina, modificabile.
  'scritto dalla pagina (editor di testo ricco)': (dentro) => `<!doctype html><html><body style="margin:0">
    <iframe id="f" style="border:0;width:100vw;height:100vh;display:block"></iframe>
    <script>
      const d = document.getElementById('f').contentDocument;
      d.open(); d.write('<!doctype html><html><body contenteditable style="margin:0;height:3000px"><h2 id=c>scrivi qui</h2></body></html>'); d.close();
    </script></body></html>`,
  srcdoc: () => `<!doctype html><html><body style="margin:0">
    <iframe id="f" srcdoc="<h2 id=c style='margin:0'>contenuto</h2><div style='height:3000px'></div>" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`,
  'uno dentro l\'altro, di un altro sito': (dentro) => {
    const esterno = dentro.replace('127.0.0.1', 'localhost');
    return `<!doctype html><html><body style="margin:0">
    <iframe id="f" src="${esterno}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`;
  },
};

for (const [nome, fai] of Object.entries(CASI)) {
  test(`riquadro ${nome}: tasti, Ctrl+rotella e clic centrale dopo un clic sul contenuto`, async ({ app, openTab, testServer }) => {
    const interno = testServer.html(`<!doctype html><html><body style="margin:0;height:3000px"><h2 id="c" style="margin:0">il contenuto vero</h2></body></html>`);
    const medio = testServer.html(`<!doctype html><html><body style="margin:0">
      <iframe id="g" src="${interno}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
    const page = await testServer.openReady(openTab, fai(medio));
    await page.waitForTimeout(1500);
    await page.mouse.click(300, 300);

    await premi(app, page, '=');
    await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBeGreaterThan(100);
    await premi(app, page, '0');
    await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(100);

    await page.mouse.move(300, 300);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBeGreaterThan(100);
    await premi(app, page, '0');
    await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(100);

    // Il pizzico del trackpad: tanti passi piccoli, deve restare fluido come fuori.
    await page.keyboard.down('Control');
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -4); await page.waitForTimeout(30); }
    await page.keyboard.up('Control');
    await page.waitForTimeout(400);
    const pizzico = await percentOf(app, page);
    expect(pizzico, 'dieci passi minuscoli di pizzico').toBeGreaterThan(100);
    expect(pizzico, 'dieci passi minuscoli di pizzico sono diventati un salto enorme').toBeLessThan(140);
    await premi(app, page, '0');
    await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(100);

    await page.mouse.click(300, 300, { button: 'middle' });
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible({ timeout: 4000 });
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBeGreaterThan(100);
    await page.mouse.click(300, 300);
    await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
  });
}
