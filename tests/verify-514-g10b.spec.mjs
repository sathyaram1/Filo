// #514 (giro 10) — diagnostica: la tendina di SISTEMA della cronologia.
import { test, expect } from './fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen };
  });
}
async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}
async function tasto(app, keyCode, mods = []) {
  await app.evaluate(({ BrowserWindow }, [code, modifiers]) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: code, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: code, modifiers });
  }, [keyCode, mods]);
  await new Promise((r) => setTimeout(r, 1400));
}

test('A: cronologia, fuoco sulla tendina, NESSUNA tendina aperta', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  const page = await openTab('filo://history/history.html');
  await page.waitForSelector('#filter', { timeout: 15000 });
  await page.locator('#filter').focus();
  await entra(app);
  await tasto(app, 'Escape');
  console.log('A-DOPO-ESC1', JSON.stringify(await stato(app)));
  await tasto(app, 'Escape');
  console.log('A-DOPO-ESC2', JSON.stringify(await stato(app)));
});

test('B: cronologia, tendina di sistema aperta con Alt+Giu', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  const page = await openTab('filo://history/history.html');
  await page.waitForSelector('#filter', { timeout: 15000 });
  await page.locator('#filter').focus();
  await entra(app);
  await tasto(app, 'Down', ['alt']);
  await tasto(app, 'Escape');
  console.log('B-DOPO-ESC1', JSON.stringify(await stato(app)));
  await tasto(app, 'Escape');
  console.log('B-DOPO-ESC2', JSON.stringify(await stato(app)));
});

test('C: cronologia, fuoco sul corpo della pagina', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  const page = await openTab('filo://history/history.html');
  await page.waitForSelector('#filter', { timeout: 15000 });
  await page.evaluate(() => { try { document.activeElement.blur(); } catch (_) {} });
  await entra(app);
  await tasto(app, 'Escape');
  console.log('C-DOPO-ESC1', JSON.stringify(await stato(app)));
});
