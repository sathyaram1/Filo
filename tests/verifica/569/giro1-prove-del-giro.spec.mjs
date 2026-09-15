// Ponte: fa girare le prove del giro 1 del #569 anche a chi lancia Playwright.
//
// PERCHE' ESISTE
//   Le prove di questo giro sono logica pura (fini riga, indice dei file del
//   repo): non aprono Filo, quindi vivono in node:test e non in Playwright,
//   come le prove degli altri giri che finiscono in `.mjs` invece che in
//   `.spec.mjs`. Il guaio è il comando: chi corregge rilancia le prove di un
//   giro con `npx playwright test tests/verifica/<numero>`, e Playwright
//   raccoglie solo i file `.spec.mjs`. Senza questo ponte quel comando
//   risponde «No tests found» a cartella piena — la stessa risposta che dà una
//   cartella che non esiste, cioè «non c'era niente da rilanciare» detto di
//   prove che invece ci sono.
//
//   Qui il ponte le lancia in un processo a parte e riporta l'esito. Costa un
//   paio di secondi e toglie un tranello che costerebbe un giro intero.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = join(QUI, '..', '..', '..');

test('#569 giro 1: le prove del giro (fini riga) passano', () => {
  let uscita = '';
  try {
    uscita = execFileSync(
      process.execPath,
      ['--test', 'tests/verifica/569/giro1-il-cancello-regge-i-fini-riga.test.mjs'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    // Esito diverso da zero: il messaggio deve portarsi dietro QUALE prova è
    // rossa, altrimenti chi legge sa solo che qualcosa non va.
    const testo = `${e.stdout || ''}${e.stderr || ''}`;
    const rossi = testo.split('\n').filter((r) => /^not ok |^ *error:/.test(r)).join('\n');
    throw new Error(`le prove del giro 1 del #569 sono rosse:\n${rossi || testo.slice(-2000)}`);
  }
  expect(uscita).toContain('# fail 0');
});
