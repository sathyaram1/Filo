// Verifica #1343 giro 17, rilievo 1: la grandezza della suite scritta nelle istruzioni per gli agenti e nella guida del
// progetto è quella vera (porta del giro 16, ancora aperta). Non apre Filo: rilancia il controllo di logica che la misura.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

test('r1 la grandezza della suite dichiarata nei due documenti è quella vera', () => {
  const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=quanto è grande la suite', 'tests/unit/proveDeiGiri.test.mjs'], { encoding: 'utf8' });
  const errore = (r.stdout.match(/la suite raccoglie[^\n]*/) || [''])[0];
  expect(errore, 'il controllo della grandezza della suite passa').toBe('');
  expect(r.status).toBe(0);
});
