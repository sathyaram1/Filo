import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, clicca } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

test('esperimento: correttore nel feedback', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="it"><body style="margin:0;padding:40px"><p>x</p></body></html>`);
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await clicca(app, page, '.sn-fb-text');
  await page.keyboard.type('ciiao come stai ', { delay: 10 });
  const host = new URL(page.url()).host;
  await app.evaluate(({ webContents }, h) => {
    globalThis.__p = [];
    for (const wc of webContents.getAllWebContents()) {
      let qui = false; try { qui = new URL(wc.getURL()).host === h; } catch (_) {}
      if (qui) wc.on('context-menu', (_e, p) => { globalThis.__p.push({ w: p.misspelledWord, s: p.dictionarySuggestions }); });
    }
  }, host);
  const s = await statoDi(app, page, '.sn-fb-text');
  await page.mouse.click(s.x + 20, s.y + 14, { button: 'right' });
  await page.waitForTimeout(1500);
  console.log('PARAMS', JSON.stringify(await app.evaluate(() => globalThis.__p)));
  console.log('ATTR', await page.evaluate(() => document.documentElement.dataset.filoNativeWord || '(nessuno)'));
  console.log('MENU', await menuDi(page).locator('.sn-menu .sn-menu-correction').count());
});
