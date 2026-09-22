// Verifica #591 — giro 11. Stessa causa del tetto di spesa, seconda porta:
// il saldo dei crediti.
//
// I crediti sono l'argine anti-spam alla riapertura di un fix dalla bacheca:
// ognuna ne costa cinque, e quando il saldo è vuoto la riapertura viene
// rifiutata. Anche quel saldo vive sotto una chiave di memoria dello storage,
// quindi in incognito si legge come se non ci fosse mai stato: la finestra
// riparte con il saldo iniziale pieno. Chiudere l'ultima finestra incognito
// azzera l'overlay, quindi il gesto si ripete quante volte si vuole e il saldo
// vero sul disco non si muove mai.

import { test, expect } from '../../fixtures/electron.mjs';

test('il saldo vuoto deve restare vuoto anche in incognito', async ({ app }) => {
  const out = await app.evaluate(async () => {
    const Storage = globalThis.__filoStorage;
    const Cr = globalThis.SN_CREDITS;
    const costo = globalThis.SN_CONST.CREDIT.BOARD_REOPEN;

    // Finestra normale: si svuota il saldo riaprendo fix finché basta.
    for (let i = 0; i < 400; i++) {
      const r = await Cr.spendIfAffordable(costo, { kind: 'board_reopen', ref: 'a' + i });
      if (!r.ok) break;
    }
    const normale = await Cr.spendIfAffordable(costo, { kind: 'board_reopen', ref: 'dopo' });

    // Stessa macchina, stesso utente, una finestra in incognito.
    const incognito = await Storage.runIncognito(
      async () => await Cr.spendIfAffordable(costo, { kind: 'board_reopen', ref: 'incognito' }),
    );

    // Chiusa l'ultima finestra incognito l'overlay si azzera: si ricomincia.
    Storage.resetIncognito();
    const secondaSessione = await Storage.runIncognito(
      async () => await Cr.spendIfAffordable(costo, { kind: 'board_reopen', ref: 'incognito-2' }),
    );

    return { normale: normale.ok, incognito: incognito.ok, secondaSessione: secondaSessione.ok };
  });

  // Caso di riscontro: nella finestra normale l'argine tiene.
  expect(out.normale, 'col saldo vuoto la riapertura deve essere rifiutata').toBe(false);

  // Il difetto: in incognito il saldo riparte pieno, e a ogni sessione da capo.
  expect(
    out.incognito,
    'col saldo vuoto la riapertura deve essere rifiutata anche in una finestra in incognito',
  ).toBe(false);
  expect(
    out.secondaSessione,
    'chiudere e riaprire una finestra in incognito non deve restituire crediti',
  ).toBe(false);
});
