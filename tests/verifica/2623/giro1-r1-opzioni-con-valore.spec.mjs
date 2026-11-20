// #2623 giro 1: un'opzione di `git config` che prende un valore separato (`--file x`, `--type t`, `--comment c`)
// sposta la chiave dal primo operando, e la scrittura del remoto di un ramo torna a un OK leggero.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;

test('r1 il remoto di un ramo scritto con un\'opzione che prende un valore chiede conferma', () => {
  for (const cmd of [
    'git config --file .git/config branch.main.pushRemote https://altrove.example/r.git',
    'git config --type string branch.main.remote https://altrove.example/r.git',
    'git config --comment nota remote.pushDefault https://altrove.example/r.git',
    'git config set --file .git/config branch.main.pushRemote https://altrove.example/r.git',
    'git config --file .git/config remote.origin.url https://altrove.example/r.git',
  ]) {
    expect(C.classify(cmd), cmd).toBe(3);
  }
});

test('r1 la stessa forma su una chiave innocua resta un OK leggero', () => {
  expect(C.classify('git config --file .git/config user.email a@b.c')).toBe(2);
});
