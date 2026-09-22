// Verifica #591 — giro 11. Il tetto di spesa non esiste dentro una finestra
// in incognito.
//
// Tutto il lavoro poggia su un numero: quanto è stato speso questo mese sulle
// chiavi che paga l'owner. Quel numero vive nello storage, sotto una chiave di
// «memoria». In incognito lo storage risponde «non c'è niente» a tutte le
// chiavi di memoria (è la garanzia di privacy, ed è giusta), quindi il
// cancello unico legge zero speso e lascia passare qualunque chiamata, anche a
// mese già finito. Quello che si spende lì non torna mai nel conto del mese:
// l'overlay in RAM si azzera alla chiusura dell'ultima finestra incognito.
//
// Le chiavi restano leggibili (`settings` è nella allowlist), quindi la
// chiamata parte davvero, sulla chiave che paga l'owner.

import { test, expect } from '../../fixtures/electron.mjs';

// Un mese già oltre il tetto, registrato in una finestra normale.
async function meseOltreIlTetto(app, euro) {
  await app.evaluate(async (_, quanti) => {
    for (let i = 0; i < quanti; i++) {
      await globalThis.SN_COSTS.record({
        action: 'filo_chat', provider: 'openrouter', model: 'modello-x',
        usage: { costUsd: 1, keySource: 'factory' },
        pricing: null, usdToEur: 1,
      });
    }
  }, euro);
}

test('il tetto esaurito non ferma nulla in incognito', async ({ app }) => {
  await meseOltreIlTetto(app, 20);

  const out = await app.evaluate(async () => {
    const Storage = globalThis.__filoStorage;
    const Costs = globalThis.SN_COSTS;
    const Gate = globalThis.SN_MODEL_GATE;
    const settings = { monthlyLimitEur: 5 };

    const normale = {
      speso: (await Costs.getMonthly()).totalEur,
      oltre: await Costs.isOverLimit(5),
      fermato: await Gate.ensureUnderLimit(settings).then(() => false, (e) => e.code === 'LIMIT_REACHED'),
    };

    const incognito = await Storage.runIncognito(async () => ({
      speso: (await Costs.getMonthly()).totalEur,
      oltre: await Costs.isOverLimit(5),
      fermato: await Gate.ensureUnderLimit(settings).then(() => false, (e) => e.code === 'LIMIT_REACHED'),
    }));

    return { normale, incognito };
  });

  // Caso di riscontro: nella finestra normale il tetto tiene.
  expect(out.normale.speso, 'il mese deve risultare già speso').toBeGreaterThan(5);
  expect(out.normale.oltre, 'nella finestra normale il mese è oltre il tetto').toBe(true);
  expect(out.normale.fermato, 'nella finestra normale il cancello ferma la chiamata').toBe(true);

  // Il difetto: in incognito lo stesso mese risulta a zero e non ferma niente.
  expect(out.incognito.speso, 'il conto del mese deve valere anche in incognito').toBeGreaterThan(5);
  expect(out.incognito.oltre, 'il tetto esaurito deve valere anche in incognito').toBe(true);
  expect(
    out.incognito.fermato,
    'col mese esaurito il cancello deve fermare la chiamata anche in una finestra in incognito',
  ).toBe(true);
});

test('quello che si spende in incognito sparisce dal conto del mese', async ({ app }) => {
  const out = await app.evaluate(async () => {
    const Storage = globalThis.__filoStorage;
    const Costs = globalThis.SN_COSTS;

    const prima = (await Costs.getMonthly()).totalEur;
    await Storage.runIncognito(async () => {
      for (let i = 0; i < 50; i++) {
        await Costs.record({
          action: 'filo_chat', provider: 'openrouter', model: 'modello-x',
          usage: { costUsd: 2, keySource: 'factory' },
          pricing: null, usdToEur: 1,
        });
      }
    });
    const dopo = (await Costs.getMonthly()).totalEur;
    // La chiusura dell'ultima finestra incognito azzera l'overlay.
    Storage.resetIncognito();
    const dopoChiusura = (await Costs.getMonthly()).totalEur;
    return { prima, dopo, dopoChiusura };
  });

  expect(
    out.dopo - out.prima,
    'cento dollari spesi in incognito devono comparire nel conto del mese',
  ).toBeGreaterThan(50);
  expect(
    out.dopoChiusura - out.prima,
    'la spesa fatta in incognito non deve sparire quando la finestra si chiude',
  ).toBeGreaterThan(50);
});
