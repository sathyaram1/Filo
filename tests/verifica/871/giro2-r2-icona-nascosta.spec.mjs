// #871 verifica giro 2, rilievo 2: con molte icone nella barra e la finestra bassa, quella appena
// portata nella barra si vede lì, invece di finire sotto il bordo del gruppo senza un segno.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test('finestra bassa e barra piena: l\'icona appena portata nella barra si vede', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><body style="font:16px sans-serif"><p>Pagina</p></body>');
  const barra = await barraPage(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setSize(900, 540));
  await pausa(500);
  const prima = ['translate', 'screenshot', 'screenshotCrop', 'transcribe', 'share', 'saveForLater', 'qrCode', 'colorPicker', 'newTab'];
  for (const id of prima) await app.evaluate(async (_, i) => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: i, target: 'bar' }, {}), id);
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  // L'ultima, come la posa un trascinamento dal menu che cade sotto le icone che si vedono.
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'editorApp', target: 'bar' }, {}));
  await expect.poll(async () => (await statoBarra(app)).bar).toContain('editorApp');
  await expect(barra.locator('#nav .ico[data-id="editorApp"]')).toHaveCount(1);
  await pausa(600);
  const dove = await barra.evaluate(() => {
    const n = document.getElementById('nav').getBoundingClientRect();
    const b = document.querySelector('#nav .ico[data-id="editorApp"]').getBoundingClientRect();
    return { navAlto: n.top, navBasso: n.bottom, alto: b.top, basso: b.bottom };
  });
  expect(dove.alto, 'l\'icona appena posata sta dentro la parte visibile del gruppo').toBeGreaterThanOrEqual(dove.navAlto - 1);
  expect(dove.basso, 'l\'icona appena posata sta dentro la parte visibile del gruppo').toBeLessThanOrEqual(dove.navBasso + 1);
});
