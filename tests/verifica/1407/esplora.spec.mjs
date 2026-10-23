import { test, expect } from '../../fixtures/electron.mjs';

test('la sezione sul server mostra dove sta ogni parte', async ({ openTab }) => {
  const page = await openTab('filo://transparency/transparency.html?doc=privacy#il-server-di-filo');
  const voci = page.locator('#doc-body li').filter({ has: page.locator('strong', { hasText: /^(Il codice|Il database|Gli allegati dei feedback|Le identità)$/ }) });
  await expect(voci).toHaveCount(4);
  await expect(voci.nth(2)).toContainText('us-east1');
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await voci.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tests/.shots/1407-${tema}.png` });
  }
});
