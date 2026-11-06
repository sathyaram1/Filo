// Esplorazione (si cancella): la soglia e la sua stima in Preferenze e nei Modelli predefiniti, tema chiaro e scuro.
import { test, expect } from '../../fixtures/electron.mjs';

test('aspetto della soglia', async ({ app, openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await expect(prefs.locator('#contestoSoglia')).toHaveAttribute('placeholder', '70000', { timeout: 10000 });
  await prefs.locator('#contestoSoglia').fill('1');
  await prefs.locator('#contestoSoglia').blur();
  await prefs.waitForTimeout(1500);
  await prefs.locator('#sec-contesto').screenshot({ path: 'tests/.shots/g4-soglia-chiaro.png' });
  const salvata = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).contestoFilo);
  console.log('salvata', JSON.stringify(salvata), 'campo', await prefs.locator('#contestoSoglia').inputValue());
  await prefs.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await prefs.waitForTimeout(1500);
  await prefs.locator('#sec-contesto').screenshot({ path: 'tests/.shots/g4-soglia-scuro.png' });
});
