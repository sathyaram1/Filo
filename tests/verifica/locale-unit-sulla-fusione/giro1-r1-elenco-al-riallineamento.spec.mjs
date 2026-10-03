// Prova del giro 1 (verifica locale #929), rilievo 1: quando il server rimanda un lavoro delle routine al
// riallineamento perché gli unit sono rossi solo sulla fusione, chi riallinea riceve l'elenco dei test rotti.

import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('il riallineamento per unit rossi sulla fusione porta a chi lavora l’elenco dei test rotti', async () => {
  const D = await import(pathToFileURL(resolve(ROOT, 'scripts', 'dispatch.mjs')).href);
  // La critica che il server scrive nello stato del giro (unit rossi solo sulla fusione) e manda come `critique`.
  const critica = 'FAIL tecnico, non di qualità: gli unit test sono ROSSI sul risultato della fusione del ramo con main.\n'
    + 'Test rossi sulla fusione:\n  - tests/unit/qualcosa.test.mjs › TEST_ROTTO_SULLA_FUSIONE';
  const dalServer = { payload: { feedback: { text: 'segnalazione' }, critique: critica, history: [] } };
  const bucket = { role: 'fixer', branch: 'claude/lavoro', id: 'abc', num: '#1' };

  const payload = D.buildPayload(bucket, D.serverCtx(bucket, dalServer));
  const istruzioni = D.readRoleInstructions('fixer', { caso: payload.case });
  const tutto = JSON.stringify(payload) + istruzioni;
  expect(tutto, 'chi riallinea deve vedere quali test sono rossi sulla fusione').toContain('TEST_ROTTO_SULLA_FUSIONE');
});
