// Verifica #1343 giro 13, rilievo 1: le novità di questo lavoro stanno in un blocco che la linea principale non ha ancora
// fatto uscire, se no chi aggiorna non le vede mai.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const num = (v) => String(v).split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);

test('r1 le righe di questo lavoro non stanno sotto una versione già uscita sulla linea principale', () => {
  let uscita = '';
  try {
    execFileSync('git', ['fetch', '-q', 'origin', 'main'], { stdio: 'ignore' });
    uscita = JSON.parse(execFileSync('git', ['show', 'origin/main:package.json'], { encoding: 'utf8' })).version;
  } catch (_) {}
  test.skip(!uscita, 'serve la linea principale');
  require('../../../src/shared/patchNotes.js');
  const note = globalThis.SN_PATCH_NOTES?.NOTES || globalThis.SN_PATCH_NOTES?.notes || [];
  const nostre = [/Le icone che stavano in cima al menu del tasto destro/, /rimetti come prima/, /A schermo intero le schede compaiono/];
  for (const re of nostre) {
    const blocco = note.find((b) => [...(b.features || []), ...(b.fixes || [])].some((r) => re.test(r)));
    expect(blocco, `la riga ${re} c'è`).toBeTruthy();
    expect(num(blocco.version), `la riga ${re} sta sotto ${blocco.version}, e sulla linea principale è uscita la ${uscita}`).toBeGreaterThan(num(uscita));
  }
});
