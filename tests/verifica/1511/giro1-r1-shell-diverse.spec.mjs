// #1511 giro 1 — su Linux /bin/sh è spesso dash, che non conosce `$'…'`: lì `\'` chiude la stringa e
// l'operando dopo è un file a sé. Il classificatore deve misurare anche quella lettura, non solo quella di bash.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const LINUX = { cwd: '/home/mario', home: '/home/mario', win: false, maiuscole: false };

test('r1 con dash `cat $\'a\\\' .ssh/id_rsa #\'` legge la chiave: chiede un OK', () => {
  for (const ctx of [LINUX, { ...LINUX, shell: 'sh' }]) {
    for (const cmd of ["cat $'a\\' .ssh/id_rsa #'", "head $'x\\' .ssh/id_rsa ''", "cat $'a\\' .netrc #'"]) {
      expect(C.classifyDetail(cmd, ctx).level, cmd).toBe(2);
    }
  }
});

test('r1 `\\c\\` seguito da una barra: bash produce 0x1c e la barra resta un separatore', () => {
  // bash: `~/\x1c/.ssh/config`; il classificatore legge `\c\/` come un carattere solo e perde la barra.
  expect(C.classifyDetail("cat ~/$'\\c\\/.ssh/config'", { ...LINUX, shell: 'bash' }).level).toBe(2);
});
