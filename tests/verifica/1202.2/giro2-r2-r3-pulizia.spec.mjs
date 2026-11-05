// #1202.2 giro 2 — la pulizia prima del verdetto e il server devono dire la stessa cosa su chi si ferma e perché.
import { test, expect } from '@playwright/test';
import { proveDaToglierePrimaDelVerdetto, testoProvePrimaDelVerdetto } from '../../../scripts/lib/prove-tolte.mjs';

const f = (level, sede, decision = false) => ({ level, sede, decision, text: `rilievo ${level}${sede}` });

test('r2 con un 3 interno la pulizia non toglie prima del verdetto la prova di un [1i?]: col bilancio dei 3 finito il server ferma il lavoro e lo tiene fra i sospesi', () => {
  const findings = [f(3, 'i'), f(1, 'i', true)];
  const fuori = proveDaToglierePrimaDelVerdetto(['tests/verifica/1202.2/giro2-r2-bordo.spec.mjs'], findings);
  expect(fuori.map((x) => x.prova)).toEqual([]);
});

test('r3 il rifiuto della pulizia non dice «conta al più 1» di un vicino di livello 2 col «?»', () => {
  const findings = [f(2, 'v', true)];
  const testo = testoProvePrimaDelVerdetto([{ prova: 'tests/verifica/1202.2/giro2-r1-x.spec.mjs', numeri: [1] }], findings);
  expect(testo).not.toMatch(/conta al più 1/);
});
