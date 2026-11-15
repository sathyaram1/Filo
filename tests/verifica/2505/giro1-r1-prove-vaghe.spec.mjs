// Verifica #2505, giro 1, rilievo 1: «L'ho guardato» detto con altre parole è ancora una prova che nessuno può
// controllare, e la consegna deve rifiutarla come rifiuta la frase esatta.
import { test, expect } from '@playwright/test';
import '../../../src/shared/consegna.js';

const C = globalThis.SN_CONSEGNA;
const consegna = (prova) => ({
  criteri: C.CRITERI.map((k) => ({ criterio: k.n, esito: 'fatto', prova })),
  classe: { valore: 'nascosto', motivo: 'logica dietro le quinte del canale' },
});

for (const prova of ['Ho guardato', 'guardato bene', 'verificato a mano', 'tutto funziona', 'ok ok ok ok ok', 'l\'ho guardato bene']) {
  test(`r1 «${prova}» non è una prova`, () => {
    expect(C.validaConsegna(consegna(prova)).join('\n')).toMatch(/criterio 1 .*non è una prova/);
  });
}

test('r1 un test, una schermata o un elenco restano prove buone', () => {
  for (const p of ['tests/unit/conto.test.mjs, caso «il doppio di tre è sei»', 'tests/.shots/manage-consegna-dark.png',
    'strade provate: menu, scorciatoia, tasto destro, chat']) {
    expect(C.validaConsegna(consegna(p))).toEqual([]);
  }
});
