// #1072 giro 2 — il testo cercato da grep/findstr/Select-String non è un percorso: `//TODO` o `//eslint-disable`
// cercati in un file non contattano nessun computer, e non devono chiedere un OK col motivo della rete.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const CTX = { win: true, maiuscole: true, home: 'C:\\Users\\a', cwd: 'C:\\Users\\a\\proj' };

test('r2 cercare un testo che comincia con due barre resta una lettura libera', () => {
  for (const cmd of [
    'grep -n "//TODO" app.js',
    'grep -rn "//eslint-disable" src',
    'Select-String -Pattern "//TODO" -Path app.js',
    'findstr "//TODO" app.js',
  ]) {
    expect(C.classifyDetail(cmd, CTX), cmd).toEqual({ level: 1, motivo: '' });
  }
});

test('r2 un file da leggere su un computer della rete continua a chiedere', () => {
  for (const cmd of ['grep TODO //evil/x/app.js', 'grep -f //evil/x/p a.txt', 'Select-String -Path \\\\evil\\x -Pattern a']) {
    expect(C.classifyDetail(cmd, CTX).motivo, cmd).toMatch(/rete/);
  }
});
