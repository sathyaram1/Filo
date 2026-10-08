// #1072 giro 2 — `cd` col prefisso del fornitore di file di PowerShell (`FileSystem::\\host\x`) va in rete:
// Set-Location apre la connessione SMB come col percorso nudo, quindi deve chiedere un OK col motivo della rete.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const CTX = { win: true, maiuscole: true, home: 'C:\\Users\\a', cwd: 'C:\\Users\\a\\proj' };

test('r1 cd verso un computer della rete col prefisso FileSystem:: chiede un OK', () => {
  for (const cmd of [
    'cd FileSystem::\\\\evil\\x',
    'cd filesystem::\\\\evil\\x',
    'chdir FileSystem::\\\\evil\\x',
    'cd Microsoft.PowerShell.Core\\FileSystem::\\\\evil\\x',
  ]) {
    const d = C.classifyDetail(cmd, CTX);
    expect(d.level, cmd).toBe(2);
    expect(d.motivo, cmd).toMatch(/rete/);
  }
});

test('r1 cd su un disco locale col prefisso resta libero', () => {
  expect(C.classifyDetail('cd FileSystem::C:\\Users\\a\\proj', CTX).level).toBe(1);
});
