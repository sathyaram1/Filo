// Verifica #1448, giro 15 (riallineamento). Rilievo 1: in Preferenze → Correttore l'interruttore «Segnaposto» ha perso la
// sua riga e si attacca alla casella numerica che lo precede, invece di stare sotto come gli altri interruttori.

import { test, expect } from '../../fixtures/electron.mjs';

test('r1 «Segnaposto» in Preferenze sta in una riga sua, sotto la casella che lo precede', async ({ openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  const casella = pref.locator('#correttoreSegnaposti');
  await expect(casella).toBeAttached({ timeout: 8000 });
  await pref.locator('#sec-correttore').scrollIntoViewIfNeeded();
  const riga = await pref.evaluate(() => {
    const cb = document.getElementById('correttoreSegnaposti');
    const etichetta = cb.closest('label');
    const prima = document.getElementById('correttoreRiscritte').getBoundingClientRect();
    const sua = etichetta.getBoundingClientRect();
    const auto = document.getElementById('correttoreAutomatica').closest('label').getBoundingClientRect();
    return { inRiga: !!etichetta.parentElement.closest('.sn-toggle-row'), sotto: sua.top >= prima.bottom - 1, sx: Math.round(sua.left), autoSx: Math.round(auto.left) };
  });
  expect(riga.sotto).toBe(true);
  expect(riga.sx).toBe(riga.autoSx);
  expect(riga.inRiga).toBe(true);
});
