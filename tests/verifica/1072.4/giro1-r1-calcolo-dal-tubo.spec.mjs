// #1072.4 giro 1 — un percorso di rete composto da Join-Path/Split-Path/Get-Date non deve partire senza OK
// nemmeno quando i pezzi arrivano dal tubo, il parametro è abbreviato o la qualifica non è una lettera d'unità.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const WIN = { win: true, maiuscole: true, home: 'C:\\Users\\Mario', cwd: 'C:\\Users\\Mario' };

test('r1 un percorso di rete composto da un comando innocuo chiede un OK su ogni forma', () => {
  for (const cmd of [
    "Write-Output '\\\\' | Join-Path -ChildPath evil\\x | cd",
    "Get-Date -Format '\\\\\\\\' | Join-Path -ChildPath evil\\x | cd",
    "Split-Path -NoQualifier 'C:\\\\' | Join-Path -ChildPath evil\\x | cd",
    "Write-Output 'C:\\\\evil\\x' | Split-Path -NoQualifier | cd",
    'echo C:\\\\evil\\x | Split-Path -NoQualifier | Test-Path',
    'Split-Path -N C:\\\\evil\\x | cd',
    'Split-Path -No C:\\\\evil\\x | cd',
    'Split-Path -NoQualifier Env:\\\\evil\\x | cd',
    'Split-Path -NoQualifier HKCU:\\\\evil\\x | cd',
  ]) {
    expect(C.classifyDetail(cmd, WIN).level, cmd).toBeGreaterThanOrEqual(2);
  }
});

test('i calcoli su percorsi di casa restano liberi', () => {
  for (const cmd of [
    'Join-Path C:\\Users\\Mario docs | cd',
    'Split-Path -NoQualifier C:\\Users\\Mario\\x | cd',
    'Get-Date -Format yyyy-MM-dd',
  ]) {
    expect(C.classifyDetail(cmd, WIN).level, cmd).toBe(1);
  }
});
