import { test, expect } from './fixtures/electron.mjs';
test('parità link: immagine dentro un link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <a id="l" href="https://example.com/articolo"><img id="i" width="200" height="120"
      src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="></a>
  </body></html>`);
  await page.locator('#i').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  console.log('IMG-IN-LINK >>>', (await page.locator('.sn-menu').first().textContent()) || '');
});
