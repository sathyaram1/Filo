// #2292 giro 6 r1: il controllo del repository guarda una cartella diversa da quella in cui la shell entra davvero.
// cmd prende tutto il resto della riga come nome della cartella (spazi compresi); `cd -P` risale dal posto vero di
// un collegamento. In tutti e due i casi git parte nel repository ostile mentre il controllo ha guardato altrove.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea, togliCartella, collegaCartella } from '../../helpers/percorsi.mjs';

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

// Un progetto estratto da un archivio, con un'impostazione che fa partire un programma a ogni git status.
function ostile(dir, segno) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q'], dir);
  writeFileSync(join(dir, 'f'), 'a\n');
  git(['add', 'f'], dir);
  git(['commit', '-qm', 'i'], dir);
  git(['config', 'core.fsmonitor', `touch "${segno}"`], dir);
}
const risposta = (cmd, perimetro) => A.decideDettaglio({
  livello: 'default', stato: 'contaminato', campo: 'terminale',
  costo: AL.costoFor({ type: 'ESEGUI_COMANDO', comando: cmd, _perimetro: perimetro }),
}).risposta;

test('r1 in cmd «cd Progetto Mario» entra nella cartella con lo spazio: git status lì non parte senza domanda', { skip: conGit ? undefined : 'git non installato' }, () => {
  const base = cartellaTemporanea('verifica-2292-spazio-');
  try {
    // Il disco C: di Windows simulato in una cartella: la sonda vera guarda la cartella corrispondente.
    const suDisco = (p) => join(base, ...String(p).replace(/^[A-Za-z]:/, '').split(/[\\/]+/).filter(Boolean));
    ostile(suDisco('C:\\Users\\Mario\\Downloads\\Progetto Mario'), join(base, 'SEGNO'));
    const perimetro = { cwd: 'C:\\Users\\Mario\\Downloads', home: 'C:\\Users\\Mario', win: true, maiuscole: true, shell: 'cmd',
      gitLancia: (d) => T.gitLanciaIn(suDisco(d)) };
    expect(T.gitLanciaIn(suDisco('C:\\Users\\Mario\\Downloads\\Progetto Mario')), 'la cartella col progetto è ostile').toBe('si');
    for (const cmd of ['cd Progetto Mario && git status', 'chdir Progetto Mario && git diff']) {
      expect(C.classify(cmd, perimetro), cmd).toBeGreaterThanOrEqual(2);
      expect(risposta(cmd, perimetro), cmd).not.toBe('si');
    }
  } finally {
    togliCartella(base);
  }
});

test('r1 «cd -P» oltre un collegamento risale nel repository ostile: git status lì non parte senza domanda', { skip: conGit && process.platform !== 'win32' ? undefined : 'serve git e un sistema coi collegamenti di POSIX' }, () => {
  const base = cartellaTemporanea('verifica-2292-fisico-');
  try {
    const home = join(base, 'home');
    const arc = join(home, 'Downloads', 'arc');
    const segno = join(base, 'SEGNO');
    ostile(join(arc, 'evil'), segno);
    mkdirSync(join(arc, 'evil', 'dentro'));
    collegaCartella(join(arc, 'evil', 'dentro'), join(arc, 'l'));
    const cmd = 'cd -P Downloads/arc/l/.. && git status';
    const perimetro = { cwd: home, home, win: false, shell: 'sh', gitLancia: T.gitLanciaIn };
    expect(C.classify(cmd, perimetro)).toBeGreaterThanOrEqual(2);
    expect(risposta(cmd, perimetro)).not.toBe('si');
    // La shell vera ci entra e git avvia il programma del repository.
    execFileSync('sh', ['-c', cmd], { cwd: home, stdio: 'ignore' });
    expect(existsSync(segno), 'git status lanciato così avvia il programma').toBe(true);
  } finally {
    togliCartella(base);
  }
});
