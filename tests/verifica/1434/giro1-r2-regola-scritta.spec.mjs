// Verifica #1434 giro 1, rilievo 2: la pagina di regole sul tasto destro rimanda a una sezione sulla fila contestuale
// (#1434, «sezione sotto») che deve esistere e dire come è fatta.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r2 la regola della fila contestuale ha la sua sezione', () => {
  const testo = readFileSync(resolve(RADICE, 'patterns/globale-nella-barra-contestuale-nel-tasto-destro.md'), 'utf8');
  const titoli = testo.split('\n').filter((r) => /^##+ /.test(r));
  expect(titoli.some((t) => /1434/.test(t)), `titoli: ${titoli.join(' | ')}`).toBe(true);
});
