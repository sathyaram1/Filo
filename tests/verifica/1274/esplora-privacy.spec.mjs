import { test, expect } from '../../fixtures/electron.mjs';

test('il documento Privacy tiene sia il quaderno delle memorie sia le pagine delicate della PA', async ({ openTab }) => {
  const page = await openTab('filo://transparency/transparency.html?doc=privacy');
  const body = page.locator('#doc-body');
  await expect(body).toContainText('quaderno delle memorie');
  await expect(body).toContainText('INPS');
  await expect(body).toContainText('pubblica amministrazione');
});
