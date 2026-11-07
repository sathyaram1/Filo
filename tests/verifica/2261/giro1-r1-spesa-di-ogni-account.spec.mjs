// #2261 giro 1, rilievo 1: la rosa di giorno si riempie se c'è quota da spendere, non solo se OGNI account sta sotto
// il suo ritmo. Con «prima B, poi A» la spesa del giorno sta quasi tutta su B, e la condizione su ogni account ferma il
// riempimento proprio nel pomeriggio del 06/11, con A fermo a metà quota.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const piatto = (f) => readFileSync(join(RADICE, f), 'utf8').replace(/\s+/g, ' ');
const regola = (t) => t.slice(t.indexOf('**La rosa si riempie anche di giorno.**')).split('**')[2] || '';

test('r1 un account sopra il suo ritmo non ferma il riempimento se l\'altro ha quota che avanza', () => {
  for (const f of ['routines/roles/manutentore.md', 'SPEC-MANUTENTORE.md']) {
    const r = regola(piatto(f));
    expect(r, f).toContain('sostenibile');
    expect(r, f).not.toMatch(/(ultime 24 ore|ultimo giorno) di ogni account[^.]*sotto il ritmo sostenibile/);
  }
});
