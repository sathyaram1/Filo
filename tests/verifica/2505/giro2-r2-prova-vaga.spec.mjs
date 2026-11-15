// #2505 giro 2 — «l'ho guardato» detto con parole comuni passa ancora come prova di un criterio: la prova deve nominare
// qualcosa che un altro controlla (un test, una schermata, un elenco), non solo non essere fatta di parole vaghe note.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/consegna.js');
const C = globalThis.SN_CONSEGNA;

const consegna = (prova) => ({
  criteri: C.CRITERI.map((k) => ({ criterio: k.n, esito: 'fatto', prova })),
  elementi: [],
  classe: { valore: 'nascosto', motivo: 'Logica dietro, si sistema.' },
});

test('r2 una prova che dice solo «ho controllato» con altre parole è rifiutata', () => {
  for (const p of ['tutto a posto', 'Tutto a posto.', "l'ho guardato con attenzione", 'controllato a fondo', 'ricontrollato, tutto ok',
    'testato in locale', 'funziona perfettamente', 'verificato visivamente', 'Ho guardato e mi sembra a posto', 'LGTM, looks good']) {
    expect(C.validaConsegna(consegna(p)).length, `«${p}» passa come prova`).toBeGreaterThan(0);
  }
});

test('r2 un test, una schermata o un elenco restano prove buone', () => {
  for (const p of ['tests/manage-x.spec.mjs, caso «salva col titolo vuoto»', 'schermata tests/.shots/manage-consegna-dark.png',
    'strade provate: menu, scorciatoia, tasto destro, chat', 'input provati: vuoto, soli spazi, 10.000 caratteri, emoji, HTML']) {
    expect(C.validaConsegna(consegna(p)), p).toEqual([]);
  }
});
