// #816 — primo giro, rilievo 1: con un portafoglio un turno di chat non resta fermo ad aspettare il
// server dei crediti, e un server solo lento non viene raccontato come muto.

import { test, expect } from '../../fixtures/electron.mjs';
import { banco, apriBanco, chiudiBanco, riscatta, passaUnMinuto, homeDiAvvio } from './aiuti.mjs';

test.beforeAll(apriBanco);
test.afterAll(chiudiBanco);
test.beforeEach(() => banco.azzera());

function turnoDiChat(app) {
  return app.evaluate(async () => {
    const t0 = performance.now();
    const { stateText } = await globalThis.SN_FILO_STATE.assemble({ creditiFreschi: true });
    return { ms: Math.round(performance.now() - t0), testo: stateText };
  });
}

test('server dei crediti lento: il turno di chat parte subito e non dice che il server è muto', async ({ app }) => {
  await homeDiAvvio(app);
  await riscatta(app);

  // Il server risponde, ma in un secondo e mezzo: il turno non lo aspetta.
  banco.ritardoStato = 1500;
  await passaUnMinuto(app);
  const lento = await turnoDiChat(app);
  expect(lento.testo).toMatch(/Saldo: 4\.?321,5 crediti/);
  expect(lento.ms, 'il turno di chat aspetta il server dei crediti').toBeLessThan(600);

  // Il server risponde in quattro secondi (un avvio a freddo): non è muto.
  banco.ritardoStato = 4000;
  await passaUnMinuto(app);
  const lentissimo = await turnoDiChat(app);
  expect(lentissimo.ms, 'il turno di chat aspetta il server dei crediti').toBeLessThan(600);
  expect(lentissimo.testo).not.toContain('il server dei crediti non risponde');
});
