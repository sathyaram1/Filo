// Ponte: fa girare le prove del giro 3 del #569 anche a chi lancia Playwright.
//
// Stesso motivo dei ponti dei giri 1 e 2: le prove di questo giro sono logica
// pura (fini riga di un checkout, un modulo che risponde o solleva), quindi
// vivono in node:test. Chi corregge rilancia le prove di un giro con
// `npx playwright test tests/verifica/569`, e Playwright raccoglie solo i file
// `.spec.mjs`: senza questo ponte le prove del giro 3 non le rilancerebbe
// nessuno, e la risposta sarebbe «No tests found» a cartella piena.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = join(QUI, '..', '..', '..');

const PROVE = [
  'tests/verifica/569/giro3-il-checkout-di-windows-da-lf.test.mjs',
  'tests/verifica/569/giro3-il-modulo-vero-senza-binario.test.mjs',
  'tests/verifica/569/giro3-le-porte-accanto-della-sentinella.test.mjs',
];

// La prima prova scrive tutti i file del repo in una cartella usa-e-getta: dura
// più del minuto scarso che Playwright concede di suo.
test.setTimeout(5 * 60 * 1000);

test('#569 giro 3: le prove del giro passano', () => {
  let uscita = '';
  try {
    uscita = execFileSync(
      process.execPath,
      ['--test', ...PROVE],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 64 },
    );
  } catch (e) {
    const testo = `${e.stdout || ''}${e.stderr || ''}`;
    const rossi = testo.split('\n').filter((r) => /^not ok |^ *error:/.test(r)).join('\n');
    throw new Error(`le prove del giro 3 del #569 sono rosse:\n${rossi || testo.slice(-2000)}`);
  }
  expect(uscita).toContain('# fail 0');
});
