// #2678.10 giro 2 — il codice del telefono senza «pin» non arriva al modello anche quando l'etichetta ha un aggettivo,
// una relativa, un secondo apparecchio o chi lo possiede in due parole: come per il cellulare, che lì viene già tolto.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../../src/shared/pavimento.js');
const S = P.SEGNAPOSTO;

test('r1 il codice del telefono con l\'etichetta lunga diventa il segnaposto, come quello del cellulare', () => {
  for (const frase of [
    'il codice del telefono nero è 4821',
    'il codice del telefono rotto è 4821',
    'il codice del telefono che uso è 4821',
    'il codice del mio telefono che uso è 4821',
    'il codice del telefono che ho comprato ieri è 4821',
    'il codice del telefono (quello nuovo) è 4821',
    'il codice del telefono dell\'ufficio è 4821',
    'il codice del telefono di casa mia è 4821',
    'il codice del telefono di Anna Maria è 4821',
    'il codice del telefono di mia madre e di mio padre è 4821',
    'il codice del telefono mio è 4821',
    'il codice del telefono e del tablet è 4821',
    'codice del telefono e della carta: 4821',
    'the phone\'s code is 4821',
  ]) {
    const fuori = P.oscura(frase);
    expect(fuori, frase).toContain(S);
    expect(fuori, frase).not.toContain('4821');
  }
});

test('r1 l\'identificativo di un telefono che non è un codice di sblocco resta', () => {
  for (const frase of [
    'il codice del telefono del cliente è 4821',
    'il codice prodotto del telefono è 4821',
    'il codice del telefono è SM-G991B',
    'il codice di errore del telefono è 4821',
  ]) expect(P.oscura(frase), frase).toBe(frase);
});
