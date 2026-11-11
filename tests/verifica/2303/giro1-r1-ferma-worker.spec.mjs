// Verifica #2303, giro 1, rilievo 1: oltre il tetto di costo il biglietto si rilascia, ma il worker deve anche
// smettere di spendere. Chi guida il giro sa cosa fare solo dalle istruzioni della veglia. Non apre Filo.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 le istruzioni della veglia per chi guida il giro coprono il compito oltre il tetto e dicono come fermare il worker', async () => {
  const veglia = readFileSync(join(ROOT, 'routines', 'roles', '_veglia.md'), 'utf8');
  // Oggi l'uscita oltre il tetto è la stessa del worker fermo, e le istruzioni dicono solo «chiudi il giro»: un worker
  // spostato in sottofondo sopravvive al giro chiuso e continua a spendere col biglietto già rilasciato.
  expect(veglia).toMatch(/tetto/i);
  expect(veglia).toMatch(/(ferma|fermalo|interrompi|arresta)[^\n]{0,80}worker|worker[^\n]{0,80}(si ferma|fermato|interrotto)/i);
});
