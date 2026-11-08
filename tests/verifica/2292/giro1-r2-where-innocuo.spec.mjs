// #2292 giro 1 — in PowerShell `where` è Where-Object: chiede solo quando il blocco invoca qualcosa. Le sue forme
// innocue restano letture, come la stessa forma scritta dopo una barra verticale.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const PS = { cwd: 'C:\\Users\\Mario', home: 'C:\\Users\\Mario', win: true, maiuscole: true, shell: 'powershell' };

test('r2 where senza un blocco che invoca resta una lettura in PowerShell', () => {
  for (const cmd of ['where node', 'where git']) expect(C.classify(cmd, PS), cmd).toBe(1);
  expect(C.classify('where -InputObject 1 { $_ -gt 0 }', PS)).toBe(C.classify('echo 1 | where { $_ -gt 0 }', PS));
  expect(C.classify('where -InputObject 1 { Start-Process calc }', PS)).toBe(3);
});
