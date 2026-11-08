// #2292 giro 5 r1: su Windows git avvia un programma d'avvio anche col nome seguito da .exe (post-index-change.exe),
// ma la sonda cerca solo il nome nudo: un archivio estratto con quell'hook fa partire codice a un git status libero.
// Qui Windows si simula (piattaforma e percorso di git): il file .exe non si esegue, si guarda solo cosa dice la sonda.
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
const A = globalThis.SN_AUTONOMIA;
const AL = globalThis.SN_ACTION_LEVELS;
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));
const P = require(join(ROOT, 'src', 'main', 'services', 'programmaIntero.js'));

const conGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch (_) { return false; } })();
const git = (args, cwd) => execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@b', ...args], { cwd, stdio: 'ignore' });

test('r1 su Windows un hook di lettura col nome .exe fa chiedere come quello senza estensione', { skip: conGit ? undefined : 'git non installato' }, () => {
  const base = cartellaTemporanea('verifica-2292-hook-exe-');
  const piattaforma = Object.getOwnPropertyDescriptor(process, 'platform');
  const trova = P.programmaIntero;
  try {
    const repo = join(base, 'Downloads', 'progetto');
    mkdirSync(repo, { recursive: true });
    git(['init', '-q'], repo);
    writeFileSync(join(repo, 'f'), 'a\n');
    git(['add', 'f'], repo);
    git(['commit', '-qm', 'i'], repo);
    // Git per Windows cerca hooks/<nome> e, se manca, hooks/<nome>.exe (STRIP_EXTENSION): basta che il file ci sia.
    writeFileSync(join(repo, '.git', 'hooks', 'post-index-change.exe'), 'MZ');

    Object.defineProperty(process, 'platform', { ...piattaforma, value: 'win32' });
    P.programmaIntero = (n) => n;
    const ctx = { cwd: repo, home: base, win: false, shell: 'sh', gitLancia: T.gitLanciaIn };
    expect(T.gitLanciaIn(repo), 'la sonda riconosce il programma d\'avvio .exe').toBe('si');
    for (const comando of ['git status', 'git diff']) {
      expect(C.classify(comando, ctx), comando).toBeGreaterThanOrEqual(2);
      const costo = AL.costoFor({ type: 'ESEGUI_COMANDO', comando, _perimetro: ctx });
      const d = A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo, campo: 'terminale' });
      expect(d.risposta, `${comando} non deve partire senza domanda`).not.toBe('si');
    }
  } finally {
    Object.defineProperty(process, 'platform', piattaforma);
    P.programmaIntero = trova;
    togliCartella(base);
  }
});
