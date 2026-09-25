// Giro 1 — la regola scritta che ha prodotto il blocco non deve più prescriverlo.
// Il pattern è la casa della regola e la specifica del canale la racconta: se dicono ancora che il rifiuto della
// fusione rimette il lavoro in verifica, il prossimo che tocca il cancello la rimette al suo posto.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leggi = (rel) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8').replace(/\s+/g, ' ');

test('il pattern non prescrive più che il rifiuto della fusione rimetta il lavoro in verifica', () => {
  const pattern = leggi('patterns/un-controllo-vale-per-il-contenuto-esaminato-non-per-letichetta.md');
  expect(pattern).not.toContain('Il rifiuto nomina il passo che rimette il lavoro in verifica');
});

test('la specifica del canale descrive il cancello com\'è adesso: niente rientro in verifica dettato dal rifiuto', () => {
  const spec = leggi('ROUTINE-AUTH-SPEC.md');
  expect(spec).not.toContain('dice quale passo lo mette a registro: il rientro in verifica');
  expect(spec).not.toContain('sono decaduti come per un ramo mosso sotto i piedi, quindi si registra il rientro in verifica');
  expect(spec).not.toContain('non la chiede se un via libera registrato su questa macchina parla di un altro commit');
});
