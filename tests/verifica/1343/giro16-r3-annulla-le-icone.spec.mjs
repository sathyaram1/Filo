// Verifica #1343 giro 16, rilievo 3: quello che Filo legge per «rimetti come prima» deve dire che anche la disposizione
// delle icone della barra laterale si rimette: la descrizione dell'azione di annullo e il titolo dei CAMBI RECENTI.

import { test, expect } from '../../fixtures/electron.mjs';

test('r3 l\'annullo e i CAMBI RECENTI che legge il modello nominano le icone della barra laterale', async ({ app }) => {
  const letto = await app.evaluate(() => {
    const desc = globalThis.SN_ACTION_TOOLS.TOOLS.ANNULLA_CAMBIO.description;
    const sorgente = globalThis.SN_FILO_STATE.renderForPrompt.toString();
    const titolo = (sorgente.match(/'CAMBI RECENTI[^']*'/) || [''])[0];
    return { desc, titolo };
  });
  expect(letto.desc, 'la descrizione di ANNULLA_CAMBIO').toMatch(/icon/i);
  expect(letto.titolo, 'il titolo dei CAMBI RECENTI').toMatch(/icon/i);
});
