// Prova del giro 1 (verifica locale #929), rilievo 3: il controllo di sicurezza delle routine, che lancia la
// richiesta di fusione, sa che adesso dura minuti (gli unit sulla fusione) e la lancia in sottofondo; il testo non
// dice più che lì non gira niente in locale.

import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('le istruzioni del controllo di sicurezza dicono che la richiesta di fusione dura minuti e va in sottofondo', async () => {
  const D = await import(pathToFileURL(resolve(ROOT, 'scripts', 'dispatch.mjs')).href);
  const testo = D.readRoleInstructions('secaudit', {});
  const i = testo.indexOf('merge-gate.mjs');
  expect(i, 'il ruolo lancia ancora la richiesta di fusione').toBeGreaterThan(-1);
  const passo = testo.slice(Math.max(0, i - 400), i + 2500);
  expect(passo, 'la richiesta di fusione fa girare gli unit per minuti: senza dirlo, una chiamata da due minuti la taglia')
    .toMatch(/sottofondo|in background/i);
  expect(passo).not.toMatch(/Qui non gira nessun git/);
});
