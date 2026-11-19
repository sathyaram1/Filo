import { test, expect } from '@playwright/test';
import * as d from '../../agent/driver.mjs';
import { apriFiloPerLaProva } from '../../agent/provaPreparazione.mjs';

test.setTimeout(120_000);

const stato = (app) => app.evaluate(({ webContents }) => {
  const f = webContents.getFocusedWebContents();
  return { f: f ? f.getURL() : null, focused: webContents.getAllWebContents().filter((w) => !w.isDestroyed() && w.isFocused()).map((w) => w.getURL()) };
});

test('esplora: fuoco dopo il più', async () => {
  const { app, shell } = await apriFiloPerLaProva();
  try {
    await d.navigate(app, shell, 'data:text/html,<title>Modulo</title><h1>Modulo</h1>');
    await d.sleep(1000);
    await d.bringToFront(app);
    console.log('WIN', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isFocused())));
    console.log('PRIMA', JSON.stringify(await stato(app)));
    let map; let voce;
    await expect.poll(async () => { ({ map } = await d.markInteractables(app, shell)); await d.clearMarks(app, shell); voce = map.find((x) => /^Nuova scheda/.test(x.label) && x.page === 'shell'); return !!voce; }).toBe(true);
    await d.clickMark(app, shell, map, voce.i);
    for (let i = 0; i < 6; i++) { await d.sleep(500); console.log('DOPO', i, JSON.stringify(await stato(app))); }
    const v = await d.activeView(app, shell);
    console.log('HOME', v && v.url(), v && await v.evaluate(() => [document.activeElement && document.activeElement.id, document.hasFocus()]));
  } finally { await d.closeFilo(app); }
});
