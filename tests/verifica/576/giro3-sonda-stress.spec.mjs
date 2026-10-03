import { test, expect } from '../../fixtures/electron.mjs';

test('sonda: pagina aperta a blocco spento, acceso e spento in fretta', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => {
    const A = globalThis.__filoAdblock;
    A.setDomainsForTest(['blocked.test']);
    A.setCosmeticForTest('##.ad-slot');
    A.configureFromSettings({ security: { adblock: { enabled: false } } });
  });
  const ad = testServer.origin.replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<!doctype html><title>STRESS</title>
<div class="ad-slot" id="slot">riquadro</div><p id="t">testo</p>`, { pubblico: true });
  const vis = () => page.evaluate(() => getComputedStyle(document.getElementById('slot')).display !== 'none');
  expect(await vis()).toBe(true);
  const set = (on) => app.evaluate((_e, v) => globalThis.__filoAdblock.configureFromSettings({ security: { adblock: { enabled: v } } }), on);
  await set(true);
  await expect.poll(vis, { timeout: 4000 }).toBe(false);
  for (const v of [false, true, false, true, false, true]) await set(v);
  await expect.poll(vis, { timeout: 4000 }).toBe(false);
  await set(false);
  await expect.poll(vis, { timeout: 4000 }).toBe(true);
  // immagine bloccata aggiunta a blocco spento poi acceso
  await set(true);
  await page.evaluate((u) => { const i = new Image(300, 250); i.id = 'img'; i.src = u + '/x.gif'; document.body.appendChild(i); }, ad);
  await expect.poll(() => page.evaluate(() => document.getElementById('img').getBoundingClientRect().height), { timeout: 4000 }).toBe(0);
  await set(false);
  await expect.poll(() => page.evaluate(() => document.getElementById('img').getBoundingClientRect().height), { timeout: 4000 }).toBe(250);
});
