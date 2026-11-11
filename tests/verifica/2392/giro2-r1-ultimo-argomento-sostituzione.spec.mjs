// #2392 giro 2 — in bash `$_` dopo un comando che finisce con una sostituzione vale ciò che la sostituzione stampa:
// è un valore che si conosce solo eseguendo, quindi il comando che lo usa non può passare per una lettura.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;

test('r1 dopo una sostituzione fra gli argomenti `$_` è ignoto e git log che lo usa chiede conferma', () => {
  for (const shell of ['bash', 'sh']) {
    const ctx = { cwd: '/home/u/proj', home: '/home/u', shell };
    for (const cmd of [
      'echo $(echo --output=/home/u/.bashrc); git log $_',
      'echo $(cat f); git log $_',
      'echo $(cat f) && git log -1 $_',
    ]) expect(C.classify(cmd, ctx), `${shell}: ${cmd}`).toBeGreaterThanOrEqual(2);
  }
});
