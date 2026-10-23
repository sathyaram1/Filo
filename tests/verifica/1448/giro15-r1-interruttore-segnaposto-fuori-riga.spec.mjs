// Verifica #1448, giro 15 (riallineamento). Rilievo 1: l'interruttore «Segnaposto» ha perso la sua riga in Opzioni → Altro
// (scritta non cliccabile e diversa dalle altre) e in Preferenze → Correttore (scritta disallineata).

import { test, expect } from '../../fixtures/electron.mjs';

test('r1 in Opzioni → Altro un clic sulla scritta «Segnaposto» spegne i segnaposti, e la scritta è come le altre', async ({ app, openTab }) => {
  const altro = await openTab('filo://options/altro.html');
  const scritta = altro.locator('#spellcheckSegnaposti-label');
  await expect(scritta).toHaveText('Segnaposto', { timeout: 8000 });
  await expect(altro.locator('#spellcheckSegnaposti')).toBeChecked();
  const peso = await altro.evaluate(() => [
    getComputedStyle(document.getElementById('spellcheckSegnaposti-label')).fontWeight,
    getComputedStyle(document.getElementById('spellcheckAutomatica-label')).fontWeight,
  ]);
  expect(peso[0]).toBe(peso[1]);
  await scritta.click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).correttore.segnaposti), { timeout: 5000 }).toBe(false);
});

test('r1 «Segnaposto» in Preferenze è allineato agli altri interruttori del correttore', async ({ openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#correttoreSegnaposti')).toBeAttached({ timeout: 8000 });
  await pref.locator('#sec-correttore').scrollIntoViewIfNeeded();
  const misura = await pref.evaluate(() => {
    const scritta = (id) => document.getElementById(id).closest('label').querySelector('span').getBoundingClientRect();
    const riga = (id) => document.getElementById(id).closest('label').getBoundingClientRect();
    return {
      segnaposto: Math.round(scritta('correttoreSegnaposti').left),
      web: Math.round(scritta('correttoreSegnapostiWeb').left),
      automatica: Math.round(scritta('correttoreAutomatica').left),
      altezzaSegnaposto: Math.round(riga('correttoreSegnaposti').height),
      altezzaWeb: Math.round(riga('correttoreSegnapostiWeb').height),
    };
  });
  expect(misura.web).toBe(misura.automatica);
  expect(misura.segnaposto).toBe(misura.automatica);
  expect(misura.altezzaSegnaposto).toBe(misura.altezzaWeb);
});
