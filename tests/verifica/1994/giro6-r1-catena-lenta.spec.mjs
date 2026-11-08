// #1994 giro 6: il valore di $_ preso dal comando prima non deve costare più del resto della classificazione: su main
// diecimila comandi che si passano $_ l'uno all'altro si classificano in un decimo di secondo, nel processo principale.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;

test('r1 una lunga catena di comandi che si passano $_ si classifica subito', () => {
  test.setTimeout(180_000);
  for (const shell of ['bash', 'sh']) {
    const cmd = 'echo a; ' + 'git log $_; '.repeat(12000);
    const t = Date.now();
    C.classify(cmd, { home: '/home/u', cwd: '/home/u/proj', shell });
    expect(Date.now() - t, shell).toBeLessThan(1500);
  }
});
