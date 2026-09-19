// Giro di verifica locale del ramo claude/link-invito — giro 5.
//
// Il campo dell'invito legge quello che gli si incolla cercando un blocco di
// otto caratteri lungo tutta la riga, e riparte da un carattere dopo ogni
// blocco scartato. Su un incollaggio sbagliato molto lungo — un articolo, un
// documento finito lì per errore — quel modo di cercare cresce col quadrato
// della lunghezza. Il conto non lo fa la pagina: lo fa il cuore di Filo, che
// nel frattempo non risponde a nessuna scheda.
//
// Dieci e ventimila caratteri (le misure che i giri passati avevano provato)
// restano sotto il decimo di secondo. È più in là che si ferma tutto.
//
// Scritto da chi verifica, non da chi ha fatto il lavoro.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/wallet.js');
const W = globalThis.SN_WALLET;

test('un incollaggio sbagliato molto lungo non deve fermare Filo', () => {
  for (const n of [10000, 50000, 200000]) {
    const testo = '-'.repeat(n);
    const inizio = Date.now();
    expect(W.codeFromInput(testo)).toBe(null);
    const durata = Date.now() - inizio;
    expect(durata, `${n} caratteri letti in ${durata}ms`).toBeLessThan(2000);
  }
});
