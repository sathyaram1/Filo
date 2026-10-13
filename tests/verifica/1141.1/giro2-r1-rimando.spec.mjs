// Verifica #1141.1 giro 2: l'aiuto comune rimanda alle sue sentinelle; un rimando a una prova che non c'è più svia
// chi lo legge per sapere dove vive la regola.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 le sentinelle citate dall\'aiuto senzaSessione esistono', () => {
  const testo = readFileSync(join(ROOT, 'tests', 'helpers', 'senzaSessione.mjs'), 'utf8');
  const citate = [...testo.matchAll(/(\w+\.test\.mjs)/g)].map((m) => m[1]);
  expect(citate.filter((f) => !existsSync(join(ROOT, 'tests', 'unit', f)))).toEqual([]);
});
