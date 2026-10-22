import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, clicca } from './helpers/riquadri.mjs';

const SPIA = `<script>
  window.__letti = [];
  for (const t of ['dragstart','drag','dragend','dragenter','dragover','drop','copy','cut','select','selectstart']) {
    window.addEventListener(t, (e) => {
      let dt = '';
      try { dt = e.dataTransfer ? e.dataTransfer.getData('text/plain') : ''; } catch (_) {}
      window.__letti.push(t + ':' + dt);
    }, true);
  }
</script>`;

test('esperimento: trascinare dentro la casella', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px"><p>x</p>${SPIA}</body></html>`);
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await clicca(app, page, '.sn-fb-text');
  await page.keyboard.type('parola segreta qui', { delay: 5 });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  await page.evaluate(() => { window.__letti = []; });
  const s = await statoDi(app, page, '.sn-fb-text');
  await page.mouse.move(s.x + 30, s.y + 12);
  await page.mouse.down();
  await page.mouse.move(s.x + 60, s.y + 40, { steps: 5 });
  await page.mouse.move(s.x + 80, s.y + 50, { steps: 5 });
  console.log('CLASSI', (await statoDi(app, page, '.sn-fb-modal')).classi);
  await page.mouse.up();
  await page.waitForTimeout(500);
  console.log('VALORE', (await statoDi(app, page, '.sn-fb-text')).valore);
  console.log('LETTI', JSON.stringify(await page.evaluate(() => window.__letti)));
});
