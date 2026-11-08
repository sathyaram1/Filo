// #1994 giro 5: aprire le graffe come bash non deve costare più del resto della classificazione: su main un comando
// di 60.000 graffe si classifica in decine di millisecondi, e il conto gira nel processo principale.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;

test('r2 un comando lungo pieno di graffe si classifica subito', () => {
  test.setTimeout(180_000);
  const casi = [
    ['bash', { home: '/home/u', cwd: '/home/u/proj', shell: 'bash' }],
    ['powershell', { home: 'C:\\Users\\u', cwd: 'C:\\Users\\u\\proj', win: true, shell: 'powershell' }],
  ];
  for (const [nome, ctx] of casi) {
    for (const cmd of ['git log ' + '{'.repeat(30000) + '}'.repeat(30000), 'echo ' + '{x}'.repeat(20000)]) {
      const t = Date.now();
      C.classify(cmd, ctx);
      expect(Date.now() - t, `${nome}: ${cmd.slice(0, 20)}…`).toBeLessThan(1000);
    }
  }
});
