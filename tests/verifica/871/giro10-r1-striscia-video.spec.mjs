// #871 giro 10, rilievo 1 (scelta dell'owner): col video a tutto schermo la striscia del bordo non resta sopra il film.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra } from '../../helpers/barra.mjs';

test('r1 video a tutto schermo: la striscia del bordo non resta sopra il film', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<!doctype html><title>Film</title><body style="margin:0;background:#000"><div id="v" style="width:100vw;height:100vh;background:#050505"></div><script>document.getElementById("v").addEventListener("click",()=>document.getElementById("v").requestFullscreen())</script></body>');
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  const barra = await barraPage(app);
  await page.locator('#v').click();
  await expect.poll(async () => (await statoBarra(app)).schermoIntero, { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 800));
  const visibile = await barra.evaluate(() => {
    const s = document.getElementById('striscia');
    const r = s.getBoundingClientRect();
    return r.width > 0 && Number(getComputedStyle(s, '::before').opacity) > 0;
  });
  expect(visibile).toBe(false);
});
