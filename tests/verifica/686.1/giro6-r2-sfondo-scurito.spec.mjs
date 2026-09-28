// #686.1 giro 6, rilievo 2: su un sito che dà uno sfondo a tutti i livelli in
// primo piano, aprire il riquadro dello zoom scurisce e sfoca la pagina intera.
// Successo: col riquadro aperto la pagina resta come prima, senza velo.
import { test, expect } from '../../fixtures/electron.mjs';

test('il riquadro dello zoom non vela la pagina su un sito che dà uno sfondo ai livelli in primo piano', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head>
    <style>::backdrop { background: rgba(0,0,0,.6); backdrop-filter: blur(6px); }</style></head>
    <body style="height:4000px"><h1>un sito qualunque</h1><p>testo da leggere</p></body></html>`);
  const url = await page.evaluate(() => location.href);
  await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = ''; try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      wc.sendInputEvent({ type: 'mouseDown', x: 150, y: 600, button: 'middle', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: 150, y: 600, button: 'middle', clickCount: 1 });
    }
  }, url);
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  const velo = await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('__filo-zoom-badge'), '::backdrop');
    return { sfondo: s.backgroundColor, filtro: s.backdropFilter };
  });
  expect(velo.sfondo, 'la pagina si scurisce').toBe('rgba(0, 0, 0, 0)');
  expect(velo.filtro, 'la pagina si sfoca').toBe('none');
});
