// Verifica #2505, giro 1, rilievo 2: il file che scrive su disco i dati salvati dell'utente (e cifra i suoi segreti a
// riposo) è il cuore del «formato dei dati salvati»: un ramo che lo tocca esce irreparabile anche se dichiarato visibile.
import { test, expect } from '@playwright/test';
import '../../../src/shared/consegna.js';

const C = globalThis.SN_CONSEGNA;

test('r2 un ramo che cambia come si scrive storage.json esce irreparabile per il minimo', () => {
  const min = C.minimoDaiPercorsi({ app: ['src/main/shim/storage.js', 'tests/unit/storageDurevole.test.mjs'] });
  expect(min.classe).toBe('irreparabile');
  expect(min.zone.map((z) => z.chiave)).toContain('dati');
  expect(C.classeFinale('visibile', min.classe)).toEqual({ classe: 'irreparabile', decisaDa: 'minimo' });
});

test('r2 la sola prova della scrittura dei dati resta alla classe dichiarata', () => {
  expect(C.minimoDaiPercorsi({ app: ['tests/unit/storageDurevole.test.mjs'] }).classe).toBe('');
});
