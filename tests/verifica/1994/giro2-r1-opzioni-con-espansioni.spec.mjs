// #1994 giro 2: un'opzione con dentro un'espansione che la shell risolve a vuoto (`$1`, `$@`, `$!`, una variabile
// minuscola non impostata, le graffe di bash, `$null` di PowerShell) è la stessa opzione per il programma.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const CTX = { home: '/home/u', cwd: '/home/u/proj' };
const livello = (cmd, shell) => C.classify(cmd, { ...CTX, shell });

test('r1 git --output con un parametro vuoto di bash scrive un file: non è una lettura libera', () => {
  for (const cmd of [
    'git log -1 --format=x%n --out$1put=/home/u/.bashrc',
    'git log -1 --format=x%n --out$@put=/home/u/.bashrc',
    'git log -1 --format=x%n --out$*put=/home/u/.bashrc',
    'git log -1 --format=x%n --out"$1"put=/home/u/.bashrc',
    'git log -1 --format=x%n --out$!put=/home/u/.bashrc',
    'git log -1 --format=x%n --output$pwd=/home/u/.bashrc',
    'git diff --no-index a b --out$1put=x',
  ]) {
    expect(livello(cmd, 'bash'), cmd).toBeGreaterThanOrEqual(2);
  }
});

test('r1 git --output dentro le graffe di bash scrive un file: non è una lettura libera', () => {
  expect(livello('git log -1 --format=x%n --{output=/home/u/.bashrc,}', 'bash')).toBeGreaterThanOrEqual(2);
});

test('r1 git --output con $null di PowerShell scrive un file: non è una lettura libera', () => {
  const ctx = { home: 'C:\\Users\\u', cwd: 'C:\\Users\\u\\proj', win: true, shell: 'powershell' };
  expect(C.classify('git log -1 --format=x%n --output$null=C:\\Users\\u\\a.bat', ctx)).toBeGreaterThanOrEqual(2);
});

test('r1 la stessa causa sugli altri lettori corretti e su date -s', () => {
  for (const cmd of ['tree -$1o x', 'file -$1C', 'date -$1s 1']) {
    expect(livello(cmd, 'bash'), cmd).toBeGreaterThanOrEqual(2);
  }
});
