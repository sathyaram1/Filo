// TEMP audit spec — exercise the cookie trusted-sites whitelist. Delete after.
import { test, expect } from './fixtures/electron.mjs';

test('cookie whitelist: privacy mode add/validate/dup/remove', async ({ openTab }) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8000 });
  // privacy mode enables the whitelist UI
  await sec.locator('input[name="cookie-mode"][value="privacy"]').check();
  await expect(sec.locator('#cookie-wl-input')).toBeEnabled({ timeout: 4000 });

  const input = sec.locator('#cookie-wl-input');
  const addBtn = sec.locator('#cookie-wl-add-btn');
  const list = sec.locator('#cookie-wl-list');
  const err = sec.locator('#cookie-wl-error');

  // 1) valid add
  await input.fill('Example.com');
  await addBtn.click();
  await expect(list).toContainText('example.com', { timeout: 4000 });

  // 2) invalid input → error, not added
  await input.fill('notadomain');
  await addBtn.click();
  await expect(err).toBeVisible({ timeout: 4000 });
  console.log('ERR TEXT after invalid:', await err.textContent());
  await expect(list).not.toContainText('notadomain');

  // 3) duplicate → dup message
  await input.fill('example.com');
  await addBtn.click();
  console.log('ERR TEXT after dup:', await err.textContent());

  // count rows with a remove button (exclude empty placeholder)
  const rowCount = await list.locator('button').count();
  console.log('ROWS with buttons:', rowCount);

  // 4) remove invariant
  await list.locator('button').first().click();
  await sec.waitForTimeout(300);
  console.log('LIST after remove:', (await list.textContent())?.replace(/\s+/g, ' ').trim());

  await sec.screenshot({ path: 'tests/.shots/audit-cookie-wl.png' });
});
