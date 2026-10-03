// Verifica #530 giro 4, rilievo 2: a Normale, compito pulito, il costo 2 parte da solo; anche riordinare le schede.
import { test, expect } from '../../fixtures/electron.mjs';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('Normale, compito pulito: riordinare le schede non aspetta un bottone e un OK', async ({ app }) => {
  const r = await execAction(app, { type: 'PULISCI_TAB' });
  // Oggi torna «tenuta» senza essere partita: la chat mostra un bottone e poi un popup, a ogni livello.
  expect(r.kept && !r.executed, 'il costo 2 a compito pulito parte da solo').toBe(false);
});
