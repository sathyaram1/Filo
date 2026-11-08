// #2292 giro 1 — un repository arrivato da fuori può portare le impostazioni che avviano programmi dentro un suo
// sottomodulo: `git status` e `git diff` nel repository principale le eseguono. La lettura deve chiedere, o non avviarle.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const T = require('../../../src/main/services/terminal.js');

const git = (args, cwd) => execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'protocol.file.allow=always', ...args],
  { cwd, stdio: 'ignore' });

test('r1 un sottomodulo che avvia un programma: git status e git diff chiedono, o il programma non parte', async () => {
  test.skip(process.platform === 'win32', 'il programma di prova è touch');
  const base = cartellaTemporanea('filo-2292-g1-');
  try {
    mkdirSync(join(base, 'sub'));
    git(['init', '-q'], join(base, 'sub'));
    git(['commit', '-q', '--allow-empty', '-m', 's'], join(base, 'sub'));
    mkdirSync(join(base, 'super'));
    const sup = join(base, 'super');
    git(['init', '-q'], sup);
    git(['submodule', '-q', 'add', '../sub', 'sub'], sup);
    git(['commit', '-q', '-m', 'init'], sup);
    const segno = join(base, 'AVVIATO');
    git(['config', '-f', join(sup, '.git', 'modules', 'sub', 'config'), 'core.fsmonitor', `touch "${segno}"`], sup);

    const ctx = { cwd: sup, home: base, win: false, shell: 'sh', gitLancia: T.gitLanciaIn };
    for (const cmd of ['git status', 'git diff']) {
      const livello = C.classify(cmd, ctx);
      if (livello >= 2) continue;
      rmSync(segno, { force: true });
      await T.runCommand(cmd, { cwd: sup, shell: 'sh' });
      expect(existsSync(segno), `«${cmd}» passa senza chiedere e avvia il programma del sottomodulo`).toBe(false);
    }
  } finally {
    togliCartella(base);
  }
});
