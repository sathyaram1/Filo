// Verifica #2339 giro 1, rilievo 1: nello storico dei giri un esterno, che dalla scala a tre non ha livello, non deve
// finire nella riga di un «livello 0» che non c'è più.
import { test, expect } from '@playwright/test';

test('r1 lo storico dei giri non conta gli esterni senza livello come livello 0', async () => {
  const m = await import('../../../scripts/storico-giri.mjs');
  const t = m.totali([{ rounds: [{ found: [2, null], external: [null], fixed: [2], consumed: 'cap2', outcome: 'corregge' }] }]);
  const zero = t.perLivello[0] || { trovati: 0, esterni: 0 };
  expect(zero.trovati, 'un esterno contato fra i trovati di livello 0').toBe(0);
  expect(zero.esterni, 'un esterno contato fra gli esterni di livello 0').toBe(0);
  const esterni = Object.values(t.perLivello).reduce((s, l) => s + l.esterni, 0) + (Number(t.esterni) || 0);
  expect(esterni, 'l\'esterno del giro deve restare contato, da qualche parte').toBeGreaterThan(0);
});
