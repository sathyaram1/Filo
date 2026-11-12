import { test } from '../../fixtures/electron.mjs';

test('aspetto della sezione in Preferenze', async ({ openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  const s = pref.locator('#sec-testo-campi');
  await s.scrollIntoViewIfNeeded();
  await s.screenshot({ path: 'tests/.shots/v2378-chiaro.png' });
  await pref.emulateMedia({ colorScheme: 'dark' });
  await pref.waitForTimeout(300);
  await s.screenshot({ path: 'tests/.shots/v2378-scuro.png' });
});
