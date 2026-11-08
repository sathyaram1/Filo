// #2292 giro 2 — il controllo delle impostazioni git guarda la cartella scritta nel comando, non quella in cui la
// shell entra davvero: con un asterisco il nome scritto non esiste, il controllo dice «niente da avviare» e git parte.
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

const git = (args, cwd) => execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@b', ...args], { cwd, stdio: 'ignore' });

test('r1 un repository estratto nei Download, raggiunto con un asterisco: git status chiede, o il programma non parte', async () => {
  test.skip(process.platform === 'win32', 'il programma di prova è touch');
  const base = cartellaTemporanea('filo-2292-g2-');
  try {
    const casa = join(base, 'casa');
    const ostile = join(casa, 'Downloads', 'progetto-1.0');
    mkdirSync(ostile, { recursive: true });
    git(['init', '-q'], ostile);
    git(['commit', '-q', '--allow-empty', '-m', 's'], ostile);
    const segno = join(base, 'AVVIATO');
    git(['config', 'core.fsmonitor', `touch "${segno}"`], ostile);

    const ctx = { cwd: casa, home: casa, win: false, shell: 'sh', gitLancia: T.gitLanciaIn };
    for (const cmd of ['cd Downloads/*/ && git status', 'cd Downloads/progetto* && git diff', 'cd Downloads/progetto-?.0 && git log']) {
      const livello = C.classify(cmd, ctx);
      if (livello >= 2) continue;
      rmSync(segno, { force: true });
      await T.runCommand(cmd, { cwd: casa, shell: 'sh' });
      expect(existsSync(segno), `«${cmd}» è livello ${livello} e avvia il programma del repository`).toBe(false);
    }
  } finally {
    togliCartella(base);
  }
});
