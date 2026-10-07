// Verifica #685.1 giro 4, rilievo 1: su Mac, con la barra laterale aperta da tastiera (ha il fuoco),
// Cmd+← non torna indietro, mentre Cmd+[ e Alt+← (altrove) sì.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, pannelloFermo, premi } from '../../helpers/barra.mjs';

test('r1 barra laterale aperta da tastiera su Mac: Cmd+← torna indietro come Cmd+[', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><h1>A</h1>');
  const b = testServer.html('<!doctype html><title>B</title><h1>B</h1>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.evaluate((u) => { location.href = u; }, b);
  await page.waitForURL(b);
  await app.evaluate(() => { Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true }); });
  const barra = await barraPage(app);
  await premi(app, 'tab', 'B', ['meta', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  expect((await statoBarra(app)).motivo).toBe('tasto');
  await premi(app, 'barra', 'Left', ['meta']);
  await expect.poll(() => page.url(), { timeout: 8_000 }).toBe(a);
});
