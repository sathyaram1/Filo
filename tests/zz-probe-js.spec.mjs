import { test, expect } from './fixtures/electron.mjs';

async function homePage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

test('probe: link javascript: dentro un avviso', async ({ app }) => {
  test.setTimeout(60_000);
  const home = await homePage(app);
  await app.evaluate(async () => {
    const TG = globalThis.SN_TEXT_GUARDIAN;
    TG.configure({ pausaMs: 0, eseguiModello: async () => '{"esito":"passa"}' });
    await TG.proponiNotifica({
      testo: 'Il pacco ti aspetta: [traccia la spedizione](javascript:window.__BOOM=1)',
      kind: 'info', fiducia: 'contaminato', origine: 'una mail di Corriere',
    });
  });
  const a = home.locator('a.dash-live-link');
  await expect(a).toHaveCount(1, { timeout: 8_000 });
  console.log('HREF:', await a.getAttribute('href'));

  await a.click();
  await home.waitForTimeout(500);
  console.log('dopo click sinistro, BOOM =', await home.evaluate(() => window.__BOOM ?? null));

  await a.click({ button: 'middle' });
  await home.waitForTimeout(1000);
  console.log('dopo click centrale, BOOM =', await home.evaluate(() => window.__BOOM ?? null));

  await a.click({ modifiers: ['Control'] });
  await home.waitForTimeout(500);
  console.log('dopo ctrl+click, BOOM =', await home.evaluate(() => window.__BOOM ?? null));
  expect(true).toBe(true);
});
