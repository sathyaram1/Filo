// Giro 1 di #2501, rilievo 2: se l'ultima corsa della suite non è arrivata in fondo a una sua parte, le prove rosse di
// quella parte spariscono dall'elenco del lavoro settimanale, che le crede verdi.

import { test, expect } from '@playwright/test';
import { rossiDaCorse } from '../../../scripts/lib/rossiSuite.mjs';

const registro = (completo, rossi) => ({ completo, rossi: new Set(rossi), instabili: new Set() });

test('r2 una prova rossa resta nell\'elenco settimanale anche quando l\'ultima corsa non ha girato la sua parte', () => {
  const uno = 'tests/uno.spec.mjs › la home si apre';
  const due = 'tests/due.spec.mjs › il menu si chiude';
  const esito = rossiDaCorse([
    { sha: 'a'.repeat(40), url: 'https://example.invalid/1', quando: '2026-11-10T00:00:00Z', registro: registro(true, []) },
    { sha: 'b'.repeat(40), url: 'https://example.invalid/2', quando: '2026-11-11T00:00:00Z', registro: registro(true, [uno, due]) },
    { sha: 'c'.repeat(40), url: 'https://example.invalid/3', quando: '2026-11-12T00:00:00Z', registro: registro(false, ['parte 3 di 4 della suite senza esito', uno]) },
  ]);
  const prove = esito.rossi.map((r) => r.prova);
  expect(prove).toContain(uno);
  expect(prove, 'la prova rossa della parte che l\'ultima corsa non ha finito è sparita dall\'elenco').toContain(due);
});
