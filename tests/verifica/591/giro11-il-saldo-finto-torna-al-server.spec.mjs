// Verifica #591 — giro 11. Terza porta della stessa causa: il saldo pieno che
// la finestra in incognito si inventa non resta in incognito.
//
// Ogni mutazione del saldo fa partire, quattro secondi dopo, una scrittura del
// saldo sul server. Il rinvio nasce dentro il contesto della finestra che ha
// mosso il saldo, e quel contesto si porta dietro anche i timer: la scrittura
// rilegge quindi il saldo dell'overlay in RAM, cioè quello inventato, e non
// quello vero sul disco. Il saldo vuoto di chi ha finito i crediti torna così
// pieno sul server, e da lì rientra nella finestra normale.

import { test, expect } from '../../fixtures/electron.mjs';

test('la scrittura ritardata non deve leggere il saldo inventato dell\'incognito', async ({ app }) => {
  const out = await app.evaluate(async () => {
    const Storage = globalThis.__filoStorage;
    const Cr = globalThis.SN_CREDITS;

    // Saldo vero sul disco: vuoto.
    await Cr.writeState({ ...(await Cr.readState()), balance: 0 });
    const veroPrima = (await Cr.readState()).balance;

    // Dentro incognito: una chiamata AI muove il saldo (inventato, pieno) e
    // programma la scrittura sul server esattamente come fa Filo.
    const letto = await Storage.runIncognito(async () => {
      await Cr.recordConsumption({ action: 'filo_chat', costEur: 0.01, provider: 'openrouter', model: 'm' });
      return await new Promise((res) => {
        setTimeout(async () => { res((await Cr.readState()).balance); }, 30);
      });
    });

    return { veroPrima, letto };
  });

  expect(out.veroPrima, 'il saldo vero deve partire da zero').toBe(0);
  expect(
    out.letto,
    'la scrittura ritardata deve mandare al server il saldo vero, non quello che la finestra in incognito si è inventata',
  ).toBeLessThan(100);
});

test('caso di riscontro: da una finestra normale la scrittura ritardata legge il saldo vero', async ({ app }) => {
  const letto = await app.evaluate(async () => {
    const Cr = globalThis.SN_CREDITS;
    await Cr.writeState({ ...(await Cr.readState()), balance: 7 });
    return await new Promise((res) => {
      setTimeout(async () => { res((await Cr.readState()).balance); }, 30);
    });
  });
  expect(letto).toBeLessThan(100);
});
