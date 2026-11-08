// #1994 giro 1 — un'opzione scritta con gli escape della shell (`--out\put`, `$'--output=…'`, `--out^put` in cmd)
// è la stessa opzione per il programma: deve valere quanto la grafia piana.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const CTX = { home: '/home/u', cwd: '/home/u/proj' };
const livello = (cmd, shell) => C.classify(cmd, { ...CTX, shell });

test('r1 git --output con escape bash scrive un file: vale come la grafia piana', () => {
  for (const cmd of [
    'git log -1 --format=x --out\\put=/home/u/.bashrc',
    'git log \\--output=/home/u/.bashrc',
    'git log --output\\=/home/u/.bashrc',
    "git log $'--output=/home/u/.bashrc'",
    'git diff --no-index a b --out\\put=x',
  ]) {
    expect(livello(cmd, 'bash'), cmd).toBe(3);
  }
});

test('r1 git --output con il cappelletto di cmd vale come la grafia piana', () => {
  for (const cmd of ['git log --out^put=x', 'git log ^-^-output=x']) {
    expect(livello(cmd, 'cmd'), cmd).toBe(3);
  }
});

test('r1 tree -o e file -C con escape scrivono un file: non sono letture libere', () => {
  for (const [cmd, shell] of [['tree -\\o x', 'bash'], ['file -\\C', 'bash'], ['tree -^o x', 'cmd']]) {
    expect(livello(cmd, shell), cmd).toBeGreaterThanOrEqual(2);
  }
});

test('r1 la stessa causa sulle opzioni che c erano già: push forzato e date -s', () => {
  expect(livello('git push --forc\\e', 'bash')).toBe(livello('git push --force', 'bash'));
  expect(livello('date -\\s 1', 'bash')).toBeGreaterThanOrEqual(2);
});
