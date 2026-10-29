// Verifica #1547 giro 4 (aperto dal giro 1): nella pagina Privacy «Serve a distinguere il problema di una persona sola»
// deve parlare dello pseudonimo, non dell'identità anonima messa fra le due frasi.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r2 fra lo pseudonimo e «Serve a distinguere» non si parla dell’identità', () => {
  for (const f of ['transparency/privacy.md', 'site/transparency/privacy.html']) {
    const testo = readFileSync(join(RADICE, f), 'utf8');
    const m = /e cambia ogni mese\.([^\n]*?)Serve a distinguere il problema di una persona sola/.exec(testo);
    expect(m, `${f}: la frase sullo pseudonimo`).toBeTruthy();
    expect(m[1], f).not.toMatch(/identit/);
  }
});
