// Verifica #1448, giro 15 (riallineamento). Rilievo 1: in Preferenze → Correttore l'interruttore «Segnaposto» ha perso la
// sua riga: la scritta parte più a sinistra di quella degli altri interruttori, e la riga ha un'altra spaziatura.

import { test, expect } from '../../fixtures/electron.mjs';

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
