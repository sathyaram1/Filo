// #1994 giro 3: un elenco di PowerShell (`'a','--output=x'`) arriva al programma come argomenti separati, e in cmd
// `%PATH:~0,0%` vale niente; `file --comp` è `--compile` per getopt. Le opzioni vanno lette come le riceve il programma.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const WIN = { home: 'C:\\Users\\u', cwd: 'C:\\Users\\u\\proj', win: true };
const BAT = 'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.bat';

test('r1 git --output dentro un elenco di PowerShell scrive un file: non è una lettura libera', () => {
  for (const cmd of [
    `git log -1 --format=x%n HEAD,'--output=${BAT}'`,
    `git log -1 --format=x%n 'HEAD','--output=${BAT}'`,
    `git log -1 --format=x%n 'HEAD' ,'--output=${BAT}'`,
    `git log -1 "--format=x%n","--output=${BAT}"`,
    "git diff --no-index a b,'--output=x'",
  ]) {
    expect(C.classify(cmd, { ...WIN, shell: 'powershell' }), cmd).toBeGreaterThanOrEqual(2);
  }
});

test('r1 le opzioni distruttive dentro un elenco di PowerShell restano distruttive', () => {
  expect(C.classify("git push origin,'--force'", { ...WIN, shell: 'powershell' })).toBe(3);
  expect(C.classify("git checkout 'main','--','.'", { ...WIN, shell: 'powershell' })).toBe(3);
});

test('r1 git --output con una variabile di cmd tagliata a vuoto scrive un file: non è una lettura libera', () => {
  for (const cmd of [
    `git log -1 --format=x%n --out%PATH:~0,0%put="${BAT}"`,
    `git log -1 --format=x%n --output%USERNAME:~0,0%="${BAT}"`,
    `git log -1 --format=x%n --out%PATH:~9999%put="${BAT}"`,
  ]) {
    expect(C.classify(cmd, { ...WIN, shell: 'cmd' }), cmd).toBeGreaterThanOrEqual(2);
  }
});

test('r2 file con --compile abbreviato compila come --compile', () => {
  const ctx = { home: '/home/u', cwd: '/home/u/proj', shell: 'bash' };
  for (const cmd of ['file -m mio --comp', 'file -m mio --compil']) {
    expect(C.classify(cmd, ctx), cmd).toBeGreaterThanOrEqual(2);
  }
});
