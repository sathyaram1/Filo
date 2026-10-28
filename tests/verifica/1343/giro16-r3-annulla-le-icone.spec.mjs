// Verifica #1343 giro 16, rilievo 3: quello che Filo legge per «rimetti come prima» deve dire che anche la disposizione
// delle icone della barra laterale si rimette: la descrizione dell'azione di annullo e il titolo dei CAMBI RECENTI.

import { test, expect } from '../../fixtures/electron.mjs';

test('r3 l\'annullo e i CAMBI RECENTI che legge il modello nominano le icone della barra laterale', async ({ app }) => {
  const letto = await app.evaluate(() => {
    const desc = globalThis.SN_ACTION_TOOLS.TOOLS.ANNULLA_CAMBIO.description;
    const stato = globalThis.SN_FILO_STATE.renderForPrompt({
      tabs: [], memories: [], timers: [], notifications: [], dashboard: null, cambi: { righe: [], tolti: 0 },
    });
    const titolo = String(stato).split('\n').find((r) => r.startsWith('CAMBI RECENTI')) || '';
    return { desc, titolo };
  });
  expect(letto.desc, 'la descrizione di ANNULLA_CAMBIO').toMatch(/icon/i);
  expect(letto.titolo, 'il titolo dei CAMBI RECENTI').toMatch(/icon/i);
});
