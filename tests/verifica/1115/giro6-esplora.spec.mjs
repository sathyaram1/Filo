// Esplorazione del riallineamento #1115: gli interruttori del blu in Preferenze e in Opzioni → Altro restano una cosa sola.
import { test, expect } from '../../fixtures/electron.mjs';

const flags = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).featureFlags);

test('blu da Preferenze e da Altro: stessa impostazione, le pagine aperte si seguono, gli altri interruttori restano', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const prefs = await openTab('filo://preferences/preferences.html');
  const altro = await openTab('filo://options/altro.html');
  const bluPrefs = prefs.locator('#correttoreAcceso');
  const bluAltro = altro.locator('#spellcheckBlu');
  const ocra = altro.locator('#spellcheckOcra');
  await expect(bluAltro).toBeChecked({ timeout: 8000 });
  await expect(ocra).toBeChecked();
  await expect(bluPrefs).toBeChecked();

  // Una riga scritta e non salvata nell'elenco dei siti esclusi non deve sparire quando arriva un cambio da altrove.
  await altro.locator('#blocklist').click();
  await altro.keyboard.type('esempio');

  await prefs.bringToFront();
  await bluPrefs.uncheck();
  await expect.poll(() => flags(app), { timeout: 4000 }).toMatchObject({ spellcheck: false, spellcheckContext: true, help: true, categorize: false });
  await altro.bringToFront();
  await expect(bluAltro).not.toBeChecked({ timeout: 4000 });
  await expect(ocra).toBeChecked();
  await expect(altro.locator('#blocklist')).toHaveValue(/esempio/);

  await ocra.click();
  await expect.poll(() => flags(app), { timeout: 4000 }).toMatchObject({ spellcheck: false, spellcheckContext: false, help: true, categorize: false });
  await bluAltro.click();
  await expect.poll(() => flags(app), { timeout: 4000 }).toMatchObject({ spellcheck: true, spellcheckContext: false, help: true });
  await prefs.bringToFront();
  await expect(bluPrefs).toBeChecked({ timeout: 4000 });
});
