// #2292 giro 4 r1: la sonda delle impostazioni git guarda solo la configurazione, non i programmi d'avvio (hook)
// che un repository estratto da un archivio porta in .git/hooks. Un `git status` li fa partire: resta livello 1 e,
// a livello Normale con compito contaminato, parte senza domanda. Rosso finché la lettura non riconosce anche gli hook.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
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

const conGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch (_) { return false; } })();
const git = (args, cwd) => execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@b', ...args], { cwd, stdio: 'ignore' });

test('un repository estratto con un programma d\'avvio in .git/hooks non resta una lettura', { skip: conGit ? undefined : 'git non installato' }, () => {
  const base = cartellaTemporanea('verifica-2292-hook-');
  try {
    const repo = join(base, 'Downloads', 'progetto');
    mkdirSync(repo, { recursive: true });
    git(['init', '-q'], repo);
    writeFileSync(join(repo, 'f'), 'a\n');
    git(['add', 'f'], repo);
    git(['commit', '-qm', 'i'], repo);
    // Il programma che l'archivio porta: git lo avvia a un refresh dell'indice (p.es. git status).
    const segno = join(base, 'SEGNO');
    const hook = join(repo, '.git', 'hooks', 'post-index-change');
    writeFileSync(hook, `#!/bin/sh\ntouch "${segno.replace(/\\/g, '/')}"\n`);
    chmodSync(hook, 0o755);

    // Che il programma parta davvero quando git legge lo stato: senza questo la prova non proverebbe niente.
    execFileSync('git', ['status'], { cwd: repo, stdio: 'ignore' });
    expect(existsSync(segno), 'il programma dell\'archivio parte a git status').toBe(true);

    const ctx = { cwd: repo, home: base, win: false, shell: 'sh', gitLancia: T.gitLanciaIn };
    // La sonda deve accorgersi che una lettura qui avvia un programma.
    expect(T.gitLanciaIn(repo), 'la sonda riconosce il programma d\'avvio del repository').toBe('si');
    // Quindi git status non è una lettura libera, e a livello Normale con compito contaminato non parte da solo.
    for (const comando of ['git status', 'cd Downloads/progetto && git status']) {
      const c = comando.startsWith('cd') ? { ...ctx, cwd: base } : ctx;
      expect(C.classify(comando, c), comando).toBeGreaterThanOrEqual(2);
      const costo = AL.costoFor({ type: 'ESEGUI_COMANDO', comando, _perimetro: c });
      const d = A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo, campo: 'terminale' });
      expect(d.risposta, `${comando} non deve partire senza domanda`).not.toBe('si');
    }
  } finally {
    togliCartella(base);
  }
});
