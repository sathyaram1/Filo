import { test, expect } from '../../fixtures/electron.mjs';

test('esplora: nome con lo spazio accanto a un sito, riaperta la pagina e nella blacklist', async ({ openTab }) => {
  const s = await openTab('filo://security/security.html');
  await expect(s.locator('#sec-delicate')).toBeChecked({ timeout: 8000 });
  await s.locator('#sec-delicate-sites').fill('studio rossi sito-a.test, mario bianchi\n  luca  verdi  ');
  await s.locator('#sec-delicate-sites').blur();
  await expect(s.locator('#sec-delicate-sites-error')).toContainText('studio rossi, mario bianchi, luca  verdi', { timeout: 4000 });
  await s.waitForTimeout(800);
  await s.reload();
  await expect(s.locator('#sec-delicate-sites')).toHaveValue(/studio rossi\nsito-a\.test\nmario bianchi/, { timeout: 8000 });
  await expect(s.locator('#sec-delicate-sites-error')).toContainText('studio rossi, mario bianchi');
  await s.screenshot({ path: 'tests/.shots/718-3-delicati.png' });

  const bl = s.locator('#sec-siteblock-blacklist');
  console.log('blacklist disabled?', await bl.isDisabled());
  if (await bl.isDisabled()) {
    await s.locator('#sec-siteblock').check().catch(() => {});
  }
  if (!(await bl.isDisabled())) {
    await bl.fill('banca-x.test studio rossi');
    await bl.blur();
    await expect(s.locator('#sec-siteblock-blacklist-error')).toContainText('studio rossi', { timeout: 4000 });
    console.log('errore blacklist:', await s.locator('#sec-siteblock-blacklist-error').textContent());
  }
  await s.locator('#sec-dl-trusted').fill('mario bianchi download-x.test').catch(() => {});
  await s.locator('#sec-dl-trusted').blur().catch(() => {});
  await s.waitForTimeout(800);
  console.log('errore fidati:', await s.locator('#sec-dl-trusted-error').textContent().catch(() => '?'));
});
