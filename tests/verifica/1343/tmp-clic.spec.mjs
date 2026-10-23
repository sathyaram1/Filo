import { test, expect } from '../../fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const tmEval = (app, fn, arg) => app.evaluate(({ BrowserWindow }, a) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  return new Function('tm', 'arg', a.fn)(tm, a.arg);
}, { fn, arg });
const cima = (app) => tmEval(app, 'const t = tm.tabs.find((x) => x.id === tm.activeId); return { y: t.view.getBounds().y, fila: tm.tabRowHeight };');
const PAG = `<!doctype html><html><body style="margin:0;font:16px sans-serif;height:1400px">
    <div style="height:100px"></div><a id="link" href="#arrivato" style="display:inline-block;height:20px;margin-left:200px">vai al capitolo</a>
    <div style="height:400px"></div><h2 id="arrivato">Capitolo</h2></body></html>`;

for (const [nome, schermo, attesa, tenuta] of [
  ['controllo senza schermo intero', false, 300, 120],
  ['schede scoperte, clic 300ms dopo il primo movimento, tenuto 120ms', true, 300, 120],
  ['schede scoperte, clic 100ms dopo, tenuto 100ms', true, 100, 100],
]) {
  test(nome, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, PAG);
    if (schermo) {
      await tmEval(app, 'tm.setContentFullscreen(true)');
      await expect.poll(async () => (await cima(app)).y).toBe(0);
      await page.mouse.move(400, 200);
      await page.mouse.move(400, 0, { steps: 4 });
      await expect.poll(async () => { const c = await cima(app); return c.y === c.fila; }).toBe(true);
      await pausa(300);
    }
    const box = await page.locator('#link').boundingBox();
    const x = Math.round(box.x + 20);
    const y = Math.round(box.y + 10);
    const allaPagina = (ev) => tmEval(app, 'tm.tabs.find((x) => x.id === tm.activeId).view.webContents.sendInputEvent(arg)', ev);
    await allaPagina({ type: 'mouseMove', x, y });
    await pausa(attesa);
    const prima = (await cima(app)).y;
    await allaPagina({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await pausa(tenuta);
    const salita = prima - (await cima(app)).y;
    console.log(nome, 'salita', salita);
    await allaPagina({ type: 'mouseUp', x, y: y + salita, button: 'left', clickCount: 1 });
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 3000 }).toBe('#arrivato');
  });
}
