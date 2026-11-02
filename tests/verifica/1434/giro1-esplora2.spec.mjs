// Esplorazione del verificatore di #1434 (2): le azioni della fila eseguite davvero.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { modelloFinto } from '../../helpers/chatFinta.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Esplora</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <p id="testo">Good morning my dear friend.</p>
  <img id="foto" src="${img}" width="160" height="120" alt="foto">
  <p><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
  </body></html>`;
const log = (...a) => console.log('[ESPLORA]', ...a);
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().flatMap((w) => (w._filoTabs?.tabs || []).map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return '?'; } })));

test('azioni vere', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  const menu = menuDi(page);

  await page.locator('#vai').click({ button: 'right' });
  await expect(menu.locator('[data-sn-icon-id="link:openTab"]')).toBeVisible();
  await menu.locator('[data-sn-icon-id="link:openTab"]').click();
  await page.waitForTimeout(1500);
  log('schede dopo openTab', JSON.stringify(await schede(app)));

  await page.bringToFront().catch(() => {});
  await page.locator('#vai').click({ button: 'right' });
  await menu.locator('[data-sn-icon-id="link:copy"]').click();
  await page.waitForTimeout(500);
  log('appunti dopo link:copy', await app.evaluate(({ clipboard }) => clipboard.readText()));

  await page.locator('#foto').click({ button: 'right' });
  await menu.locator('[data-sn-icon-id="immagine:copy"]').click();
  await page.waitForTimeout(1200);
  log('immagine negli appunti', await app.evaluate(({ clipboard }) => { const i = clipboard.readImage(); return i.isEmpty() ? 'vuota' : JSON.stringify(i.getSize()); }));

  await page.locator('#foto').click({ button: 'right' });
  await menu.locator('[data-sn-icon-id="immagine:ask"]').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/1434-ask.png' });

  await modelloFinto(app, [{ text: 'Buongiorno mio caro amico.' }]);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const el = document.getElementById('testo'); const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const b = await page.locator('#testo').boundingBox();
  await page.mouse.click(b.x + 30, b.y + b.height / 2, { button: 'right' });
  await menu.locator('[data-sn-icon-id="testo:translate"]').click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/.shots/1434-traduci.png' });
  log('menu aperto dopo traduci', await menu.pannelli.count());

  await page.keyboard.press('Escape');
  await page.mouse.click(b.x + 30, b.y + b.height / 2, { button: 'right' });
  await page.waitForTimeout(300);
  const prima = (await schede(app)).length;
  if (await menu.locator('[data-sn-icon-id="testo:search"]').count()) await menu.locator('[data-sn-icon-id="testo:search"]').click();
  await page.waitForTimeout(1500);
  const dopo = await schede(app);
  log('cerca', prima, JSON.stringify(dopo.slice(-1)));
});

test('tema scuro', async ({ app, openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  await editor.keyboard.type('Alfa beta gamma');
  await editor.keyboard.press('Control+a');
  const b = await editor.locator('#doc p').first().boundingBox();
  await editor.mouse.click(b.x + 20, b.y + b.height / 2, { button: 'right' });
  await editor.waitForTimeout(600);
  await editor.screenshot({ path: 'tests/.shots/1434-editor-scuro.png' });
  await editor.keyboard.press('Escape');
  const page = await testServer.openReady(openTab, SITO(img));
  await page.locator('#foto').click({ button: 'right' });
  await page.waitForTimeout(600);
  await menuDi(page).locator('.sn-menu-row-overflow').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/1434-immagine-scuro.png' });
});
