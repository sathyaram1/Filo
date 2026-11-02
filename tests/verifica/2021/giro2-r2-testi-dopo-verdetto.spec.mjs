// #2021 giro 2: dopo il verdetto la spinta del rilascio entra nel registro; ruolo e pattern non devono dire ancora che il
// registro non la vede e che la pratica fidata si ferma alla fusione.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const FILE = ['routines/roles/_critica-e-livelli.md', 'patterns/le-prove-di-un-giro-stanno-nel-ramo-e-la-cartella-si-svuota.md'];

test('r2 le istruzioni del verificatore non dicono più che un commit dopo il verdetto sfugge al registro', () => {
  for (const f of FILE) {
    const testo = readFileSync(join(ROOT, f), 'utf8').replace(/\s+/g, ' ');
    expect(testo, f).not.toMatch(/spinta che il registro della fiducia non vede/);
  }
});
