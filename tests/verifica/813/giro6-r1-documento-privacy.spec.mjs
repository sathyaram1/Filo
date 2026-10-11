// Verifica di #813, sesto giro, rilievo 1: il documento sulla privacy che Filo mostra non deve più dire, in nessun
// punto, che Safe Browsing riceve gli indirizzi delle pagine.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 il documento sulla privacy non dice più da nessuna parte che Google riceve gli indirizzi delle pagine', async ({ app }) => {
  const testo = await app.evaluate(() => globalThis.SN_TRANSPARENCY.asText('privacy'));
  expect(testo).toContain('a Google manda solo i primi 4 byte');
  expect(testo).not.toMatch(/Safe Browsing riceve (gli indirizzi|l'indirizzo)/);
});
