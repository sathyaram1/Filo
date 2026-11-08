// #2292 giro 5 r3: chiavi che strumenti comuni scrivono nel repository dell'utente (VS Code, GitHub CLI) non avviano
// niente a una lettura, ma non sono fra quelle inerti: in quei repository ogni lettura di git chiede un OK dopo una
// pagina letta, e sempre al livello Conservativo.
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

test('r3 un repository con le chiavi di VS Code e di GitHub CLI resta una lettura libera', { skip: conGit ? undefined : 'git non installato' }, () => {
  const base = cartellaTemporanea('verifica-2292-chiavi-');
  try {
    const repo = join(base, 'progetti', 'sito');
    mkdirSync(repo, { recursive: true });
    git(['init', '-q', '-b', 'main'], repo);
    writeFileSync(join(repo, 'f'), 'a\n');
    git(['add', 'f'], repo);
    git(['commit', '-qm', 'i'], repo);
    git(['remote', 'add', 'origin', 'https://example.com/sito.git'], repo);
    // VS Code, creando un ramo, segna da dove parte; gh, scelto il repository predefinito, lo scrive sul remoto.
    git(['config', 'branch.main.vscode-merge-base', 'origin/main'], repo);
    git(['config', 'remote.origin.gh-resolved', 'base'], repo);
    expect(T.gitLanciaIn(repo), 'nessuna di queste chiavi avvia un programma').toBe('');
    expect(C.classify('git status', { cwd: repo, home: base, win: false, shell: 'sh', gitLancia: T.gitLanciaIn })).toBe(1);
  } finally {
    togliCartella(base);
  }
});
