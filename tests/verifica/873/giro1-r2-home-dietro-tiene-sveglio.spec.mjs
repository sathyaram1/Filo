// #873 giro 1, rilievo 2: una home rimasta dietro un'altra scheda continua a chiedere lo stato ogni 30 s, e il
// lettore del computer (processi ogni 3 s, su Windows un PowerShell sempre aperto) non si addormenta mai.
import { test, expect } from '../../fixtures/electron.mjs';

test('con la home dietro un\'altra scheda il lettore del sistema si addormenta', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.attivo()), { timeout: 8_000 }).toBe(true);
  await openTab(testServer.html('<h1>un sito qualunque</h1>'));
  const veglia = 90_000 + 3_000 * 2 + 5_000;
  await new Promise((r) => setTimeout(r, veglia));
  expect(await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.attivo())).toBe(false);
});
