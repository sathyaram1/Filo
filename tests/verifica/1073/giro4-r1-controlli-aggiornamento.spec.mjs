// #1073 giro 4 — il cancello che ferma gli aggiornamenti senza punto d'aggancio non deve rompere i controlli
// esistenti degli aggiornamenti automatici (su main passano tutti): un rosso lì ferma anche la pubblicazione.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 i controlli degli aggiornamenti automatici passano tutti col cancello acceso', () => {
  const { NODE_TEST_CONTEXT: _figlio, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--test', join('tests', 'unit', 'aggiornamentiAutomatici.test.mjs')],
    { cwd: ROOT, env, encoding: 'utf8', windowsHide: true });
  const fail = Number((r.stdout.match(/^# fail (\d+)/m) || [])[1]);
  expect(fail, r.stdout.slice(-1500)).toBe(0);
  expect(r.status).toBe(0);
});
