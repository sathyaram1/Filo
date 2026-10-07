// #685.1 giro 3 — la riga delle novità su Cmd+freccia deve stare in una versione non ancora uscita, o chi aggiorna non la vede.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r2 la riga di Cmd+← sta sopra l\'ultima versione uscita su main', () => {
  createRequire(import.meta.url)(path.join(ROOT, 'src', 'shared', 'patchNotes.js'));
  const PN = globalThis.SN_PATCH_NOTES;
  const uscita = JSON.parse(execFileSync('git', ['show', 'origin/main:package.json'], { cwd: ROOT, encoding: 'utf8' })).version;
  const blocco = PN.NOTES.find((n) => [...(n.features || []), ...(n.fixes || [])].some((r) => /Cmd\+←/.test(r)));
  expect(blocco, 'riga di Cmd+← assente').toBeTruthy();
  expect(PN.cmpVersion(blocco.version, uscita)).toBeGreaterThan(0);
});
