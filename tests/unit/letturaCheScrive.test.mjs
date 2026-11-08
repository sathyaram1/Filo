// #2292 — un comando «di lettura» che con certe opzioni scrive o esegue non resta livello 1. La tabella qui sotto
// copre OGNI nome delle due liste di lettura: chi ne aggiunge uno deve dire quali sue forme scrivono o eseguono.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
for (const f of ['constants.js', 'contenutoEsterno.js', 'capabilities.js', 'themeTokens.js', 'cmdClassify.js',
  'zoomPagina.js', 'autonomia.js', 'preferences.js', 'actionLevels.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const C = globalThis.SN_CMD_CLASSIFY;
const A = globalThis.SN_AUTONOMIA;
const AL = globalThis.SN_ACTION_LEVELS;
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));

const LINUX = { cwd: '/home/mario', home: '/home/mario', win: false, shell: 'sh' };
const MAC = { cwd: '/Users/mario', home: '/Users/mario', win: false, maiuscole: true, shell: 'sh' };
const PS = { cwd: 'C:\\Users\\Mario', home: 'C:\\Users\\Mario', win: true, maiuscole: true, shell: 'powershell' };
const CMD = { ...PS, shell: 'cmd' };
const CONTESTI = [undefined, LINUX, MAC, PS];

// Nome → forme che scrivono (2) o eseguono (3). Un nome senza forme del genere ha [] e si dice perché nel commento.
const FORME = {
  where: [['where -InputObject 1 { Start-Process calc }', 3], ['where -i 1 { Start-Process calc }', 3]],
  arch: [['arch -arm64 zsh -c id', 3], ['arch -x86_64 /bin/ls', 3]],
  uniq: [['uniq a.txt Documenti/tesi.txt', 2], ['uniq -f 1 - b.txt', 2]],
  tree: [['tree -o out.txt', 2], ['tree -ao out.txt', 2], ['tree -R -L 1', 2], ['tree --output=out.txt', 2]],
  file: [['file -C -m magia', 2], ['file --compile', 2]],
  date: [['date -s 2020-01-01', 2]],
  hostname: [['hostname nuovo', 2]],
};
// Senza forme che scrivono o eseguono: stampano, contano, cercano o cambiano solo la cartella di lavoro.
const INERTI = ['cd', 'chdir', 'ls', 'dir', 'pwd', 'cat', 'type', 'echo', 'whoami', 'which', 'head', 'tail', 'wc', 'ver',
  'uname', 'more', 'clear', 'cls', 'grep', 'findstr', 'stat', 'basename', 'dirname', 'realpath', 'readlink', 'du', 'df',
  'uptime', 'id', 'groups', 'whatis', 'cal', 'nproc', 'ps', 'free', 'lscpu', 'lsblk', 'lsusb', 'printenv', 'whereis',
  'who', 'w', 'vmstat', 'lsof', 'column', 'cut', 'nl', 'md5sum', 'sha1sum', 'sha256sum', 'cksum'];

test('sentinella: ogni nome delle liste di lettura sta nella tabella delle forme che scrivono o eseguono', () => {
  const { level1, ps } = C.nomiDiLettura();
  for (const nome of level1) {
    assert.ok(FORME[nome] || INERTI.includes(nome), `«${nome}» è nuovo fra le letture: scrivi qui le sue forme che scrivono o eseguono`);
  }
  // I cmdlet di PowerShell eseguono solo uno scriptblock: qualunque blocco che invochi qualcosa deve salire a 3.
  for (const nome of ps) {
    for (const ctx of [undefined, PS]) {
      assert.equal(C.classify(`${nome} { Start-Process calc }`, ctx), 3, `${nome} con un blocco che invoca`);
      assert.equal(C.classify(`${nome} -InputObject 1 { Start-Process calc }`, ctx), 3, `${nome} -InputObject con un blocco`);
    }
  }
});

test('le forme che scrivono o eseguono non restano livello 1, su ogni sistema', () => {
  for (const [nome, forme] of Object.entries(FORME)) {
    for (const [cmd, minimo] of forme) {
      for (const ctx of CONTESTI) {
        const l = C.classify(cmd, ctx);
        assert.ok(l >= minimo, `${nome}: «${cmd}» in ${ctx ? ctx.cwd : 'nessun contesto'} è ${l}, deve essere almeno ${minimo}`);
      }
    }
  }
});

test('le letture vere restano libere', () => {
  for (const [cmd, ctx] of [['arch', MAC], ['arch', LINUX], ['uniq a.txt', LINUX], ['uniq -c -f 2 a.txt', LINUX],
    ['tree -L 2', LINUX], ['tree', MAC], ['file foto.jpg', LINUX], ['file -b -c foto.jpg', LINUX], ['where node', CMD],
    ['cat a.txt | uniq', LINUX], ['Get-ChildItem | Where-Object { $_.Length -gt 0 }', PS]]) {
    assert.equal(C.classify(cmd, ctx), 1, `${cmd} in ${ctx.shell}`);
  }
});

test('where in PowerShell è Where-Object: il blocco gira, quindi 3; in cmd è where.exe', () => {
  assert.equal(C.classify('where -InputObject 1 { Start-Process calc }', PS), 3);
  assert.equal(C.classify('where -InputObject 1 { Start-Process calc }'), 3);
  assert.equal(C.classify('where node', CMD), 1);
  // Senza un blocco che invoca, Where-Object filtra e basta: resta una lettura, da solo come dopo una barra.
  for (const cmd of ['where node', 'where git', 'where -Property x -EQ 1']) assert.equal(C.classify(cmd, PS), 1, cmd);
  assert.equal(C.classify('where -InputObject 1 { $_ -gt 0 }', PS), C.classify('echo 1 | where { $_ -gt 0 }', PS));
  assert.equal(C.classify('where -InputObject (Start-Process calc) { $_ }', PS), 3);
  assert.equal(C.classify('foreach -InputObject 1 { $_ }', PS), 3, 'ForEach-Object da solo resta da chiedere');
  // Le due forme già difese e quella nuova ora dicono lo stesso.
  assert.equal(C.classify('echo 1 | where { Start-Process calc }', PS), 3);
  assert.equal(C.classify('Where-Object -InputObject 1 { Start-Process calc }', PS), 3);
});

test('arch con un programma dietro chiede «conferma», e una cancellazione dietro arch è un «per sempre»', () => {
  assert.equal(C.classify('arch -arm64 zsh -c id', MAC), 3);
  assert.equal(C.classify('arch', MAC), 1);
  assert.equal(C.cancellaPerSempre('arch -arm64 rm -rf Documents'), true);
  assert.equal(C.cancellaPerSempre('arch -arch arm64 rm x'), true);
  assert.equal(C.cancellaPerSempre('arch'), false);
});

test('uniq e tree che scrivono su un file che c\'è già lo sostituiscono: 3, come una copia', () => {
  const esiste = (p) => (/tesi\.txt$|package\.json$|out\.txt$/.test(p) ? 'file' : null);
  const ctx = { ...LINUX, esiste };
  for (const cmd of ['uniq - progetto/package.json', 'uniq a.txt Documenti/tesi.txt', 'tree -o out.txt']) {
    const d = C.classifyDetail(cmd, ctx);
    assert.equal(d.level, 3, cmd);
    assert.match(d.motivo, /sovrascrive/, cmd);
  }
  assert.equal(C.classify('uniq a.txt nuovo.txt', ctx), 2);
  assert.equal(C.classify('echo x | uniq - progetto/package.json', ctx), 3);
});

test('il cammino della decisione: a livello Normale e compito contaminato questi comandi non partono da soli', () => {
  const cmds = [['where -InputObject 1 { Start-Process calc }', PS], ['arch -arm64 zsh -c id', MAC],
    ['echo x | uniq - Documenti/tesi.txt', LINUX], ['uniq a.txt Documenti/tesi.txt', LINUX], ['tree -o out.txt', LINUX],
    ['git status', { ...LINUX, gitLancia: () => 'si' }]];
  for (const [comando, ctx] of cmds) {
    const costo = AL.costoFor({ type: 'ESEGUI_COMANDO', comando, _perimetro: ctx });
    const d = A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo, campo: 'terminale' });
    assert.notEqual(d.risposta, 'si', `«${comando}» (costo ${costo}) partirebbe senza domanda`);
  }
});

test('git: un repository con impostazioni che avviano programmi fa chiedere anche le letture', () => {
  const lancia = { ...LINUX, gitLancia: () => 'si' };
  const pulito = { ...LINUX, gitLancia: () => '' };
  for (const cmd of ['git status', 'git log', 'git diff', 'git show HEAD', 'git log | head', 'cd progetto && git status']) {
    const d = C.classifyDetail(cmd, lancia);
    assert.equal(d.level, 2, cmd);
    assert.match(d.motivo, /impostazioni di questa cartella git/, cmd);
    assert.equal(C.classify(cmd, pulito), 1, cmd);
  }
  // Senza sapere quale cartella, la sonda non può rispondere: si chiede.
  assert.equal(C.classify('git status', { ...LINUX, cwd: '', gitLancia: () => '' }), 2);
  // Una sonda che si rompe vale «non so».
  assert.equal(C.classify('git status', { ...LINUX, gitLancia: () => { throw new Error('x'); } }), 2);
  // Le opzioni globali che spostano git su un altro repository o ne cambiano le impostazioni.
  for (const cmd of ['git --git-dir=/tmp/x/.git status', 'git --work-tree=/tmp/x status', 'git --config-env=core.pager=HOME log',
    'git --exec-path=/tmp status', 'git -c core.pager=less log']) {
    assert.equal(C.classify(cmd, pulito), 3, cmd);
  }
  for (const cmd of ['git --no-pager log', 'git -P log', 'git --version', 'git --no-optional-locks status']) {
    assert.equal(C.classify(cmd, pulito), 1, cmd);
  }
});

test('git: le righe della configurazione, chiave per chiave', () => {
  const tipico = ['system\tcore.autocrlf=input', 'global\tuser.name=Mario', 'global\tcore.pager=less',
    'local\tcore.repositoryformatversion=0', 'local\tcore.filemode=true', 'local\tcore.bare=false',
    'local\tcore.logallrefupdates=true', 'local\tremote.origin.url=https://example.test/a.git',
    'local\tremote.origin.fetch=+refs/heads/*:refs/remotes/origin/*', 'local\tbranch.main.remote=origin',
    'local\tbranch.main.merge=refs/heads/main', 'local\tcore.fsmonitor=true', 'local\tcore.worktree=../../../sub'].join('\n');
  assert.equal(C.gitConfigLancia(tipico), false, 'un clone normale non fa chiedere');
  for (const riga of ['local\tcore.fsmonitor=programma', 'local\tdiff.external=programma', 'local\tdiff.x.textconv=programma',
    'local\tfilter.x.clean=programma', 'local\tcore.pager=programma', 'worktree\tcore.fsmonitor=programma',
    'local\tinclude.path=altro', 'local\tremote.origin.uploadpack=programma', 'local\textensions.partialclone=origin']) {
    assert.equal(C.gitConfigLancia(`${tipico}\n${riga}`), true, riga);
  }
  // Le impostazioni dell'utente (globali e di sistema) sono sue: non fanno chiedere.
  assert.equal(C.gitConfigLancia('global\tdiff.external=difftool\nsystem\tfilter.lfs.clean=git-lfs clean -- %f'), false);
});

const conGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch (_) { return false; } })();

test('git: la sonda vera legge il repository della cartella, senza eseguire niente', { skip: conGit ? false : 'git non installato' }, () => {
  const base = cartellaTemporanea('filo-2292-');
  try {
    const sano = join(base, 'sano');
    const ostile = join(base, 'ostile');
    for (const d of [sano, ostile]) {
      mkdirSync(d);
      execFileSync('git', ['init', '-q'], { cwd: d, stdio: 'ignore' });
    }
    // Il valore è un nome che non esiste: la prova guarda solo cosa dice la sonda, e la sonda non lo lancia.
    const segno = join(ostile, 'SEGNO');
    appendFileSync(join(ostile, '.git', 'config'), `[core]\n\tfsmonitor = programma-inesistente-filo-2292 ${segno}\n`);
    assert.equal(T.gitLanciaIn(sano), '');
    assert.equal(T.gitLanciaIn(ostile), 'si');
    assert.equal(T.gitLanciaIn(join(ostile, '.git')), 'si', 'anche da dentro la cartella .git');
    assert.equal(existsSync(segno), false);
    const ctx = { cwd: ostile, home: base, win: false, shell: 'sh', gitLancia: T.gitLanciaIn };
    assert.equal(C.classify('git status', ctx), 2);
    assert.equal(C.classify('git status', { ...ctx, cwd: sano }), 1);
  } finally {
    togliCartella(base);
  }
});
