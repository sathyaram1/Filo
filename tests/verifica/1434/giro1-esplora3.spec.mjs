// Esplorazione del verificatore di #1434 (3): quello che le azioni aprono sopra la scheda.
import { test } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { modelloFinto } from '../../helpers/chatFinta.mjs';
import { writeFileSync } from 'node:fs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Esplora</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <p id="testo">Good morning my dear friend.</p>
  <img id="foto" src="${img}" width="160" height="120" alt="foto">
  </body></html>`;
const log = (...a) => console.log('[ESPLORA]', ...a);
async function finestra(app, nome) {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return (await w.capturePage()).toPNG().toString('base64');
  });
  writeFileSync(`tests/.shots/${nome}.png`, Buffer.from(b64, 'base64'));
}

test('chiedi a Filo sull\'immagine', async ({ app, openTab, testServer }) => {
  const { nelMondoDelMenu } = await import('../../helpers/menuContestuale.mjs');
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  const menu = menuDi(page);
  await page.locator('#foto').click({ button: 'right' });
  await menu.locator('[data-sn-icon-id="immagine:ask"]').click();
  await page.waitForTimeout(2500);
  log('sidebar', await nelMondoDelMenu(app, page, () => JSON.stringify({ aperta: globalThis.SN_SIDEBAR.isOpen(), allegati: globalThis.__filoSidebarTest?.allegati?.() })));
});

test.skip('quello che si apre', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await modelloFinto(app, [{ text: 'Buongiorno mio caro amico.' }]);
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  const menu = menuDi(page);
  await page.evaluate(() => { const el = document.getElementById('testo'); const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const b = await page.locator('#testo').boundingBox();
  await page.mouse.click(b.x + 30, b.y + b.height / 2, { button: 'right' });
  await menu.locator('[data-sn-icon-id="testo:translate"]').click();
  await page.waitForTimeout(2500);
  await finestra(app, '1434-win-traduci');
  log('chiamate', await app.evaluate(() => JSON.stringify((globalThis.__chatFinta_calls || []).map((m) => JSON.stringify(m).slice(0, 200)))));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.locator('#foto').click({ button: 'right' });
  await menu.locator('[data-sn-icon-id="immagine:ask"]').click();
  await page.waitForTimeout(2500);
  await finestra(app, '1434-win-ask');
});
