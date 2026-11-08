// #1994 giro 3: `reflog` e `symbolic-ref` stanno fra le letture di git, ma `reflog expire` cancella la storia che
// serve a recuperare un commit perso e `symbolic-ref HEAD <ref>` sposta il ramo corrente.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const CTX = { home: '/home/u', cwd: '/home/u/proj', shell: 'bash' };

test('r3 git reflog expire e git symbolic-ref con un valore modificano il repository: non sono letture libere', () => {
  for (const cmd of ['git reflog expire --expire=now --all', 'git symbolic-ref HEAD refs/heads/altro']) {
    expect(C.classify(cmd, CTX), cmd).toBeGreaterThanOrEqual(2);
  }
  expect(C.classify('git reflog', CTX)).toBe(1);
  expect(C.classify('git symbolic-ref HEAD', CTX)).toBe(1);
});
