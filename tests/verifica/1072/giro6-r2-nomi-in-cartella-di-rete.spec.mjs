// #1072 giro 5 — con la cartella di lavoro su un altro computer, un comando libero che cerca un nome scelto dal
// modello in quella cartella (Get-Command, Get-Help, where di cmd, git rev-parse/show) manda il nome a quel computer.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const BASE = { win: true, maiuscole: true, home: 'C:\\Users\\a' };
// Giro 6: anche git log/diff/blame cercano il nome fra i file della cartella.
const NOMI = ['Get-Command .\\segreto', 'Get-Command -Name .\\segreto', 'Get-Help .\\segreto.ps1', 'where segreto',
  'git rev-parse segreto', 'git show segreto', 'git log segreto', 'git diff segreto', 'git blame segreto'];

test('r2 nella cartella di rete un nome cercato chiede un OK come ls', () => {
  for (const ctx of [{ ...BASE, cwd: '\\\\evil\\x' }, { ...BASE, cwd: 'Z:\\', reti: ['z'] }]) {
    expect(C.classifyDetail('ls segreto', ctx).level, `ls in ${ctx.cwd}`).toBe(2);
    for (const cmd of NOMI) expect(C.classifyDetail(cmd, ctx).level, `${cmd} in ${ctx.cwd}`).toBeGreaterThanOrEqual(2);
  }
});

test('r2 gli stessi comandi in una cartella del disco restano liberi', () => {
  const ctx = { ...BASE, cwd: 'C:\\Users\\a\\proj' };
  for (const cmd of NOMI) expect(C.classifyDetail(cmd, ctx).level, cmd).toBe(1);
});
