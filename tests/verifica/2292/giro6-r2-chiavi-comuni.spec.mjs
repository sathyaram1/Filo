// #2292 giro 6 r2: chiavi che git-lfs e la manutenzione automatica di git scrivono nel repository dell'utente non
// avviano niente a una lettura, ma fanno chiedere un OK a ogni git status dopo una pagina letta.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
for (const f of ['constants.js', 'contenutoEsterno.js', 'capabilities.js', 'themeTokens.js', 'cmdClassify.js',
  'zoomPagina.js', 'autonomia.js', 'preferences.js', 'actionLevels.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const C = globalThis.SN_CMD_CLASSIFY;
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));

const conGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch (_) { return false; } })();
const git = (args, cwd) => execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@b', ...args], { cwd, stdio: 'ignore' });

test('r2 un repository con le chiavi di git-lfs e di git maintenance resta una lettura libera', { skip: conGit ? undefined : 'git non installato' }, () => {
  const base = cartellaTemporanea('verifica-2292-chiavi6-');
  try {
    const repo = join(base, 'progetti', 'gioco');
    mkdirSync(repo, { recursive: true });
    git(['init', '-q', '-b', 'main'], repo);
    writeFileSync(join(repo, 'f'), 'a\n');
    git(['add', 'f'], repo);
    git(['commit', '-qm', 'i'], repo);
    // git-lfs, dopo il primo accesso, segna come si autentica; `git maintenance register` scrive queste due.
    git(['config', 'lfs.https://example.com/gioco.git/info/lfs.access', 'basic'], repo);
    git(['config', 'maintenance.auto', 'false'], repo);
    git(['config', 'maintenance.strategy', 'incremental'], repo);
    expect(T.gitLanciaIn(repo), 'nessuna di queste chiavi avvia un programma').toBe('');
    expect(C.classify('git status', { cwd: repo, home: base, win: false, shell: 'sh', gitLancia: T.gitLanciaIn })).toBe(1);
  } finally {
    togliCartella(base);
  }
});
