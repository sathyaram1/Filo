// Feedback alpha: in Preferenze c'è una sezione per la lettura ad alta voce
// (text-to-speech) dove si impostano voce, velocità e tono. Verifichiamo che i
// controlli esistano e che le scelte vengano persistite tra le ricariche.

import { test, expect } from './fixtures/electron.mjs';

test('Preferenze: la sezione lettura ad alta voce esiste e la velocità persiste', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#ttsRate', { timeout: 8_000 });

  // I controlli della sezione esistono.
  await expect(page.locator('#ttsVoice')).toHaveCount(1);
  await expect(page.locator('#ttsRate')).toHaveCount(1);
  await expect(page.locator('#ttsPitch')).toHaveCount(1);
  await expect(page.locator('#ttsPreview')).toHaveCount(1);

  // Cambia la velocità a 1.5× e attende il salvataggio (debounced).
  await page.locator('#ttsRate').fill('1.5');
  await page.locator('#ttsRate').dispatchEvent('input');
  await expect(page.locator('#ttsRateVal')).toHaveText('1.5×');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Persiste nello storage come settings.tts.rate.
  await expect
    .poll(() => page.evaluate(async () => (await window.SN_STORAGE.getSettings()).tts?.rate), { timeout: 4000 })
    .toBe(1.5);

  // E sopravvive a una ricarica.
  await page.reload();
  await page.waitForSelector('#ttsRate', { timeout: 8_000 });
  await expect(page.locator('#ttsRate')).toHaveValue('1.5');
  await expect(page.locator('#ttsRateVal')).toHaveText('1.5×');
});
