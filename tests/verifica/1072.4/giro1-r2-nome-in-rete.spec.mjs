// #1072.4 giro 1 — con la cartella di lavoro su un altro computer, un nome scelto dal modello non deve
// arrivare a quel computer senza OK: né dai comandi git che lo cercano fra i riferimenti, né dal tubo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const WIN = { win: true, maiuscole: true, home: 'C:\\Users\\Mario', cwd: 'C:\\Users\\Mario' };
const NET = { ...WIN, cwd: '\\\\host\\x' };
const DRV = { ...WIN, cwd: 'Z:\\x', reti: ['Z'] };

test('r2 in una cartella di rete un nome cercato da git o passato col tubo chiede un OK', () => {
  for (const ctx of [NET, DRV]) {
    for (const cmd of [
      'git cat-file -t segreto',
      'git reflog segreto',
      'git reflog show segreto',
      'git name-rev segreto',
      'git ls-tree segreto',
      'git symbolic-ref segreto',
      'Write-Output segreto | Get-Content',
      'Write-Output segreto | Test-Path',
      'Write-Output segreto | Get-Item',
      'Write-Output segreto | Resolve-Path',
      'echo segreto | cat',
    ]) {
      expect(C.classifyDetail(cmd, ctx).level, `${ctx.cwd} ${cmd}`).toBeGreaterThanOrEqual(2);
    }
  }
});

test('nella cartella di casa gli stessi comandi restano liberi', () => {
  for (const cmd of ['git cat-file -t HEAD', 'git reflog', 'Write-Output a.txt | Test-Path']) {
    expect(C.classifyDetail(cmd, WIN).level, cmd).toBe(1);
  }
});
