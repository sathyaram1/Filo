// #1072 giro 4 — stampare un testo che comincia con due barre non contatta nessun computer:
// `echo` da solo non deve chiedere un OK col motivo della rete (lo chiede solo se il testo finisce a cd/ls nel tubo).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const CTX = { win: true, maiuscole: true, home: 'C:\\Users\\a', cwd: 'C:\\Users\\a\\proj' };

test('r2 echo di un testo con due barre in testa resta una lettura libera', () => {
  for (const cmd of ['echo "//commento"', 'echo //evil', 'Write-Output "\\\\server\\cartella"']) {
    expect(C.classifyDetail(cmd, CTX), cmd).toEqual({ level: 1, motivo: '' });
  }
});

test('r2 lo stesso testo passato nel tubo a un comando che lo apre continua a chiedere', () => {
  for (const cmd of ['echo \\\\evil\\x | cd', 'Write-Output \\\\evil\\x | Get-ChildItem']) {
    expect(C.classifyDetail(cmd, CTX).level, cmd).toBeGreaterThanOrEqual(2);
  }
});
