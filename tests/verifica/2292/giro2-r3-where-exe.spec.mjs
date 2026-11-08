// #2292 giro 2 — in PowerShell il where di cmd si scrive where.exe: è la stessa lettura di where in cmd.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const PS = { cwd: 'C:\\Users\\Mario', home: 'C:\\Users\\Mario', win: true, maiuscole: true, shell: 'powershell' };
const CMD = { ...PS, shell: 'cmd' };

test('r3 where.exe in PowerShell vale quanto where in cmd', () => {
  for (const cmd of ['where.exe git', 'where.exe node', 'where.exe /R . *.txt']) {
    expect(C.classify(cmd, PS), cmd).toBe(C.classify(cmd.replace('where.exe', 'where'), CMD));
  }
});
