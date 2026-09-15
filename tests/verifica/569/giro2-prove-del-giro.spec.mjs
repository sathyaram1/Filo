// Ponte: fa girare le prove del giro 2 del #569 anche a chi lancia Playwright.
//
// Stesso motivo del ponte del giro 1: le prove di questo giro sono logica pura
// (nessuna finestra da aprire), quindi vivono in node:test. Chi corregge
// rilancia le prove di un giro con `npx playwright test tests/verifica/569`, e
// Playwright raccoglie solo i file `.spec.mjs`: senza questo ponte le prove del
// giro 2 non le rilancerebbe nessuno.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = join(QUI, '..', '..', '..');

const PROVE = [
  'tests/verifica/569/giro2-gli-unit-girano-senza-il-binario.test.mjs',
  'tests/verifica/569/giro2-la-sentinella-copre-anche-i-sorgenti.test.mjs',
];

// La prima prova rilancia tutti gli unit test in un processo a parte: dura
// quanto loro, molto più del minuto scarso che Playwright concede di suo.
test.setTimeout(10 * 60 * 1000);

test('#569 giro 2: le prove del giro passano', () => {
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
    throw new Error(`le prove del giro 2 del #569 sono rosse:\n${rossi || testo.slice(-2000)}`);
  }
  expect(uscita).toContain('# fail 0');
});
