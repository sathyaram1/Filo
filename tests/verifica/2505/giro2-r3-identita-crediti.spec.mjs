// #2505 giro 2 — il file che tiene su disco l'identità dell'installazione, su cui stanno crediti e chiave personale, è
// dati salvati che non tornano: un ramo che lo tocca esce «irreparabile» per il minimo anche se dichiarato «visibile».
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/consegna.js');
const C = globalThis.SN_CONSEGNA;

test('r3 un ramo che cambia come si salva l\'identità che porta i crediti esce irreparabile', () => {
  const m = C.minimoDaiPercorsi({ app: ['src/main/auth/anon-auth.js'] });
  expect(m.classe).toBe('irreparabile');
  expect(C.classeFinale('visibile', m.classe)).toEqual({ classe: 'irreparabile', decisaDa: 'minimo' });
});

test('r3 una sola prova di quel file resta alla classe dichiarata', () => {
  expect(C.minimoDaiPercorsi({ app: ['tests/unit/anonAuth.test.mjs'] }).classe).toBe('');
});
