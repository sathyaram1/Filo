// Verifica #591 — giro 11. Quarta porta della stessa causa: il lavoro che una
// finestra in incognito lascia indietro non torna a vedere il conto quando la
// finestra si chiude.
//
// Filo rimanda del lavoro a qualche secondo dopo: il costo di una risposta che
// si è rotta a metà lo richiede al fornitore dopo quattro, dieci e venticinque
// secondi. Quei rinvii nascono dentro il contesto della finestra che li ha
// chiesti e se lo portano dietro, quindi la registrazione arriva a una memoria
// in RAM anche quando la finestra in incognito non c'è più. Quel costo non
// entra nel conto del mese di nessuno.

import { test, expect } from '../../fixtures/electron.mjs';

test('il costo che arriva dopo la chiusura dell\'incognito deve entrare nel conto', async ({ app }) => {
  const out = await app.evaluate(async () => {
    const Storage = globalThis.__filoStorage;
    const Costs = globalThis.SN_COSTS;

    const prima = (await Costs.getMonthly()).totalEur;

    // Una finestra in incognito rimanda una registrazione di costo e si chiude.
    const fatto = Storage.runIncognito(() => new Promise((res) => {
      setTimeout(async () => {
        await Costs.record({
          action: 'filo_chat', provider: 'openrouter', model: 'modello-x',
          usage: { costUsd: 30, keySource: 'factory' },
          pricing: null, usdToEur: 1,
        });
        res(true);
      }, 40);
    }));
    Storage.resetIncognito();
    await fatto;

    return { prima, dopo: (await Costs.getMonthly()).totalEur };
  });

  expect(
    out.dopo - out.prima,
    'il costo registrato dopo la chiusura della finestra in incognito deve entrare nel conto del mese',
  ).toBeGreaterThan(20);
});

test('caso di riscontro: lo stesso rinvio da una finestra normale entra nel conto', async ({ app }) => {
  const out = await app.evaluate(async () => {
    const Costs = globalThis.SN_COSTS;
    const prima = (await Costs.getMonthly()).totalEur;
    await new Promise((res) => {
      setTimeout(async () => {
        await Costs.record({
          action: 'filo_chat', provider: 'openrouter', model: 'modello-x',
          usage: { costUsd: 30, keySource: 'factory' },
          pricing: null, usdToEur: 1,
        });
        res();
      }, 40);
    });
    return { prima, dopo: (await Costs.getMonthly()).totalEur };
  });
  expect(out.dopo - out.prima).toBeGreaterThan(20);
});
