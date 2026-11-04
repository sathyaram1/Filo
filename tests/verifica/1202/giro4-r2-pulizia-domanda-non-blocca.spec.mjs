// #1202 giro 4: la pulizia prima del verdetto deve seguire il server anche quando la domanda di un «?» che ferma dice di non bloccare.
import { test, expect } from '@playwright/test';
import { proveDaToglierePrimaDelVerdetto } from '../../../scripts/lib/prove-tolte.mjs';

const PROVE = ['tests/verifica/1202/giro4-r1-a.spec.mjs', 'tests/verifica/1202/giro4-r2-b.spec.mjs'];
const minore = { level: 1, sede: 'i', decision: true, text: 'b', domanda: { titolo: 'b', blocca: false } };

test('r2 un [3i?] con la domanda che non blocca si corregge: la prova del [1i?] accanto esce prima del verdetto', () => {
  const findings = [{ level: 3, sede: 'i', decision: true, text: 'a', domanda: { titolo: 'a', blocca: false } }, minore];
  expect(proveDaToglierePrimaDelVerdetto(PROVE, findings).map((x) => x.prova)).toContain(PROVE[1]);
});
