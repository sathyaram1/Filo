// Ponte: fa girare le prove del giro 6 del #569 anche a chi lancia Playwright.
//
// Stesso motivo dei ponti dei giri 1, 2 e 3: la prova di questo giro è logica
// pura (si legge una ricetta di GitHub e si guarda a quale job appartiene una
// riga), quindi vive in node:test. Chi rilancia le prove di un giro usa
// `npx playwright test tests/verifica/569`, e Playwright raccoglie solo i file
// `.spec.mjs`: senza questo ponte la prova non la rilancerebbe nessuno, e la
// risposta sarebbe «No tests found» a cartella piena.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = join(QUI, '..', '..', '..');

const PROVE = ['tests/verifica/569/giro6-la-versione-di-node-del-cancello.test.mjs'];

test('#569 giro 6: le prove del giro passano', () => {
  let uscita = '';
  try {
    uscita = execFileSync(
      process.execPath,
      ['--test', ...PROVE],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 16 },
    );
  } catch (e) {
    const testo = `${e.stdout || ''}${e.stderr || ''}`;
    const rossi = testo.split('\n').filter((r) => /^not ok |^ *error:/.test(r)).join('\n');
    throw new Error(`le prove del giro 6 del #569 sono rosse:\n${rossi || testo.slice(-2000)}`);
  }
  expect(uscita).toContain('# fail 0');
});
