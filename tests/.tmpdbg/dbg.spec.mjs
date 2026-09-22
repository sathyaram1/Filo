import { test, expect } from '../fixtures/electron.mjs';
test('dbg', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });
  const dest = `${testServer.html('<p>presa</p>')}?d=segreto`;
  await page.evaluate(async (d) => {
    const bolle = document.getElementById('bubbles');
    const box = document.createElement('div');
    box.innerHTML = self.SN_MARKDOWN.render(`Ecco [Apri](${d})`);
    bolle.appendChild(box);
    box.querySelector('a.filo-md-link').click();
    await new Promise((r) => setTimeout(r, 2000));
  }, dest);
  const urls = app.windows().map((w) => w.url());
  console.log(JSON.stringify({ urls }, null, 2));
});
