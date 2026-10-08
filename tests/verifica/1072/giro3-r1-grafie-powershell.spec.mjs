// #1072 giro 3 — il classificatore spezza le parole diversamente da PowerShell e cmd: virgolette tipografiche,
// trattini lunghi davanti a un parametro e la barra rovescia prima di uno spazio nascondono un percorso di rete.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const CTX = { win: true, maiuscole: true, home: 'C:\\Users\\a', cwd: 'C:\\Users\\a\\proj' };

test('r1 un percorso di rete fra virgolette tipografiche chiede come fra virgolette normali', () => {
  for (const cmd of ['cd “\\\\evil\\x”', 'cd ‘\\\\evil\\x’', 'Test-Path „\\\\evil\\x”', 'Get-ChildItem ‛\\\\evil\\x‛']) {
    expect(C.classifyDetail(cmd, CTX).motivo, cmd).toMatch(/rete/);
  }
});

test('r1 un parametro scritto col trattino lungo chiede come col trattino normale', () => {
  for (const cmd of ['Set-Location —Path:\\\\evil\\x', 'Get-ChildItem –LiteralPath:\\\\evil\\x']) {
    expect(C.classifyDetail(cmd, CTX).motivo, cmd).toMatch(/rete/);
  }
});

test('r1 la barra rovescia in coda a un operando non incolla il percorso di rete che segue', () => {
  for (const cmd of ['findstr a src\\ \\\\evil\\x\\a', 'dir C:\\ \\\\evil\\x', 'type src\\ \\\\evil\\x\\a']) {
    expect(C.classifyDetail(cmd, CTX).motivo, cmd).toMatch(/rete/);
  }
});
