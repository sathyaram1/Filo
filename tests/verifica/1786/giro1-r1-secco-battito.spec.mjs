// Giro 1 della verifica #1786: la prova a secco chiesta dall'owner deve restare a secco anche nelle accensioni fra
// una decisione del mattino e l'altra (battito, sveglie), che possono riscrivere ordine e N. Non apre Filo.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ruolo = () => readFileSync(join(ROOT, 'routines', 'roles', 'manutentore.md'), 'utf8').replace(/\r\n/g, '\n');

test('r1 l\'indicazione a secco vale anche per le accensioni che non sono la decisione del mattino', () => {
  const r = ruolo();
  const inizio = r.indexOf('- **`mattino`**');
  const fine = r.indexOf('- **gli altri motivi**');
  expect(inizio >= 0 && fine > inizio, 'le due voci della sessione accesa dal pacemaker').toBe(true);
  const fuoriDalMattino = r.slice(0, inizio) + r.slice(fine);
  expect(fuoriDalMattino.replace(/\s+/g, ' '), 'una regola a secco per battito e sveglie').toMatch(/a secco/i);
});
