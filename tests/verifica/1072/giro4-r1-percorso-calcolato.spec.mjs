// #1072 giro 4 — un percorso di rete che nel comando non c'è scritto ma che un comando "innocuo" calcola
// (Join-Path, Split-Path -NoQualifier, Get-Date -Format) e poi apre, o passa nel tubo a cd/Test-Path/ls.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const CTX = { win: true, maiuscole: true, home: 'C:\\Users\\a', cwd: 'C:\\Users\\a\\proj' };

test('r1 Join-Path che compone e risolve un percorso di rete chiede un OK', () => {
  for (const cmd of ["Join-Path '\\\\' 'evil\\x' -Resolve", "Join-Path -Path '\\\\' -ChildPath 'evil\\x' -Resolve"]) {
    expect(C.classifyDetail(cmd, CTX).level, cmd).toBeGreaterThanOrEqual(2);
  }
});

test('r1 un percorso di rete calcolato e passato nel tubo a un comando che lo apre chiede un OK', () => {
  for (const cmd of [
    "Join-Path '\\\\' 'evil\\x' | cd",
    'Split-Path -NoQualifier C:\\\\evil\\x | cd',
    "Split-Path -NoQualifier 'C:\\\\evil\\x' | Test-Path",
    'Get-Date -Format "\'\'\\\\\\\\evil\\\\x" | Get-ChildItem',
  ]) {
    expect(C.classifyDetail(cmd, CTX).level, cmd).toBeGreaterThanOrEqual(2);
  }
});

test('r1 Join-Path e Split-Path su percorsi locali restano liberi', () => {
  for (const cmd of ['Join-Path C:\\Users\\a x', 'Split-Path -Leaf C:\\Users\\a\\x.txt', 'Join-Path C:\\Users\\a proj | cd']) {
    expect(C.classifyDetail(cmd, CTX).level, cmd).toBe(1);
  }
});
