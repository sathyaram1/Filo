// Verifica #2714 giro 13: un codice descritto da una relativa («il codice che apre il cancello») detto col verbo di
// cambio arriva in chiaro al filtro principale, mentre il correttore lo copre. Logica pura, senza aprire Filo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
globalThis.self = globalThis;
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const P = globalThis.SN_PAVIMENTO;

test('r1 il codice descritto da una relativa e detto col verbo di cambio non arriva al modello', () => {
  const passati = [];
  for (const t of [
    'il codice che apre il cancello diventa 4821',
    'il codice che apre il cancello resta 4821',
    'il codice che apre la porta diventa 4821',
    'il codice che uso per il cancello diventa 4821',
    "il codice che disattiva l'allarme diventa 4821",
    'ho cambiato il codice che apre il cancello in 4821',
    'il codice che apre il cancello è diventato 4821',
  ]) {
    if (P.oscura(t).includes('4821')) passati.push(t);
  }
  expect(passati).toEqual([]);
  expect(P.oscura('il codice che apre il cancello è 4821')).not.toContain('4821');
});
