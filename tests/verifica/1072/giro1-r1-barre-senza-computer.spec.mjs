// #1072 giro 1 — un testo con due barre ma senza il nome di un computer non è un percorso di rete.
// `grep -n "// TODO" app.js` cerca i commenti in un file: nessuna connessione, non deve chiedere un OK
// col motivo «si collega a un altro computer della rete». I veri percorsi di rete restano livello 2.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const CTX = { win: true, maiuscole: true, home: 'C:\\Users\\a', cwd: 'C:\\Users\\a\\proj' };

test('r1 cercare «//» in un file resta una lettura libera', () => {
  for (const cmd of [
    'grep -n "// TODO" app.js',
    'grep "//" app.js',
    'Select-String -Pattern "// TODO" -Path app.js',
    'findstr "//" app.js',
    'Get-Content app.js | Select-String "//"',
  ]) {
    expect(C.classifyDetail(cmd, CTX), cmd).toEqual({ level: 1, motivo: '' });
  }
});

test('r1 i percorsi di rete veri continuano a chiedere', () => {
  for (const cmd of ['cd \\\\evil\\x', 'Test-Path //evil/x', 'grep a //evil/x', 'echo \\\\evil\\x | ls']) {
    expect(C.classifyDetail(cmd, CTX).level, cmd).toBe(2);
  }
});
