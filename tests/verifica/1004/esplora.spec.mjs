import { test, expect } from '../../fixtures/electron.mjs';

const CON_PASSWORD = '<p>Saldo</p><form><input name="utente"><input type="password" name="pw"></form>';

test('esplora: Sicurezza e Preferenze, chiaro e scuro', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, `<!doctype html><html><head><title>Accesso</title></head><body>${CON_PASSWORD}</body></html>`, { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  const sic = await openTab('filo://security/security.html');
  await expect(sic.locator('#sec-delicate')).toBeChecked({ timeout: 8000 });
  await sic.locator('#sec-delicate-sites').fill('https://www.StudioRossi.it/area-clienti?x=1\nmail.example.org');
  await sic.locator('#sec-delicate-sites').blur();
  await sic.waitForTimeout(800);
  const s = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.pagineDelicate);
  console.log('SITI', JSON.stringify(s));
  for (const tema of ['light', 'dark']) {
    await sic.emulateMedia({ colorScheme: tema });
    await sic.locator('#sec-delicate').scrollIntoViewIfNeeded();
    await sic.waitForTimeout(300);
    await sic.screenshot({ path: `tests/.shots/v1004-sicurezza-${tema}.png` });
  }
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#riassuntoSchede')).toBeChecked({ timeout: 8000 });
  for (const tema of ['light', 'dark']) {
    await pref.emulateMedia({ colorScheme: tema });
    await pref.locator('#riassuntoSchede').scrollIntoViewIfNeeded();
    await pref.waitForTimeout(300);
    await pref.screenshot({ path: `tests/.shots/v1004-pref-${tema}.png` });
  }
});
