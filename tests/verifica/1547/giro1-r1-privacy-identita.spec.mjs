// Verifica #1547 giro 1: la pagina Privacy non promette che il server accetti contatori solo da una copia di Filo:
// l'identità anonima la crea chiunque abbia la chiave web, che è pubblica.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 la pagina Privacy non dice che il server accetta solo contatori da una copia di Filo', () => {
  for (const f of ['transparency/privacy.md', 'site/transparency/privacy.html']) {
    const testo = readFileSync(join(RADICE, f), 'utf8');
    expect(testo, f).not.toMatch(/accetta solo contatori che arrivano da una copia di Filo/);
  }
});
