// Verifica #2571, giro 2, rilievo 1: un finish:check fermato apposta (TaskStop, Ctrl+C) non è un processo ucciso (137)
// da dichiarare come guasto. Non apre Filo.
import { test, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const modulo = pathToFileURL(join(REPO, 'scripts', 'lib', 'corsa-controlli.mjs')).href;

for (const segnale of ['SIGTERM', 'SIGINT']) {
  test(`r1 una corsa fermata con ${segnale} non diventa «processo ucciso (137)» col guasto da dichiarare`, async () => {
    test.skip(process.platform === 'win32', 'segnali POSIX');
    const root = cartellaTemporanea('filo-verifica-2571-');
    try {
      execFileSync('git', ['init', '-q', root]);
      const c = spawn(process.execPath, ['--input-type=module', '-e',
        `import { spawnSync } from 'node:child_process'; const { apriCorsa } = await import(${JSON.stringify(modulo)}); apriCorsa(${JSON.stringify(root)}, { sha: 'abcdef1234567890' }); console.log('pronto'); spawnSync('sleep', ['20']);`,
        'finish-local',
      ], { stdio: ['ignore', 'pipe', 'inherit'] });
      await new Promise((ok) => c.stdout.once('data', ok));
      const finito = new Promise((ok) => c.once('exit', ok));
      c.kill(segnale);
      await finito;
      const { corsaInterrotta, testoPerIlWorker } = await import(modulo);
      const morta = corsaInterrotta(root);
      const testo = morta ? testoPerIlWorker(morta, null) : '';
      expect(testo, 'una fermata voluta non è un SIGKILL').not.toMatch(/processo ucciso \(137\)/);
      expect(testo, 'chi ha fermato la sua corsa non deve dichiarare un guasto').not.toMatch(/--guasto/);
    } finally {
      togliCartella(root);
    }
  });
}
