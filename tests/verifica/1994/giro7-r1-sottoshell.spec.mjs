// #1994 giro 7: fuori da Windows una lettura chiusa fra parentesi (sottoshell) deve restare una lettura, come su main
// (#516). Il segnaposto che sostituisce il gruppo contiene `$_` e viene preso per l'ultimo argomento del comando prima.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;

test('r1 una lettura fra parentesi in bash, sh e zsh esegue senza conferma', () => {
  const ctx = { home: '/home/u', cwd: '/home/u', win: false };
  for (const shell of ['bash', 'sh', 'zsh']) {
    for (const cmd of ['(ls "/home/u/x" | wc -l)', '(pwd)', '(ls)', '(cd /home/u/x && ls)']) {
      expect(C.classify(cmd, { ...ctx, shell }), `${shell}: ${cmd}`).toBe(1);
    }
  }
});
