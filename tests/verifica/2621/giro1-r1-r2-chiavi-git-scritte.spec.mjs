// #2621 giro 1 — una chiave di git che avvia un programma, scritta, chiede come il programma; una che non ne avvia
// nessuno (un sì/no del paginatore) resta all'OK leggero di prima.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const CTX = { home: '/home/u', cwd: '/home/u/proj', shell: 'bash' };

// Provato con git 2.43: gc.pruneExpire, gc.autoPackLimit e poi git add + git commit fanno partire l'aggancio.
test('r1 scrivere l\'aggancio della pulizia di git chiede conferma come il programma che avvia', () => {
  expect(C.classify('python3 evil.py', CTX)).toBe(3);
  for (const cmd of [
    'git config gc.recentObjectsHook "python3 evil.py"',
    'git config --global gc.recentObjectsHook "python3 evil.py"',
    'git config set gc.recentobjectshook "python3 evil.py"',
  ]) {
    expect(C.classify(cmd, CTX), cmd).toBe(3);
  }
});

test('r2 spegnere o accendere il paginatore di un comando resta un OK leggero', () => {
  for (const cmd of [
    'git config --global pager.branch false',
    'git config pager.log true',
  ]) {
    expect(C.classify(cmd, CTX), cmd).toBe(2);
  }
});
