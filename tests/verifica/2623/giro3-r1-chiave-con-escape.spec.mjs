// #2623 giro 3: una chiave del push scritta con un backslash in mezzo (`re\mote`), che bash legge come `remote`,
// sfugge alla regola e la scrittura torna a un OK leggero.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;

test('r1 la chiave del push scritta col backslash della shell chiede conferma', () => {
  for (const cmd of [
    'git config branch.main.re\\mote https://altrove.example/r.git',
    'git config branch.main.push\\Remote https://altrove.example/r.git',
    'git config remote.push\\Default https://altrove.example/r.git',
    'git config remote.origin.u\\rl https://altrove.example/r.git',
  ]) {
    expect(C.classify(cmd), cmd).toBe(3);
  }
});

test('r1 la stessa grafia su una chiave innocua resta un OK leggero', () => {
  expect(C.classify('git config branch.main.mer\\ge refs/heads/main')).toBe(2);
});
