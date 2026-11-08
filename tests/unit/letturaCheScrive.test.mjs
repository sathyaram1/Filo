// #2292 — un comando «di lettura» che con certe opzioni scrive o esegue non resta livello 1. La tabella qui sotto
// copre OGNI nome delle due liste di lettura: chi ne aggiunge uno deve dire quali sue forme scrivono o eseguono.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
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

// Le letture di PowerShell, come quelle comuni: nome → forme che scrivono o eseguono, oltre allo scriptblock che vale per tutti.
const FORME_PS = {};
// Stampano, filtrano, convertono in testo o cambiano la cartella di lavoro: nessuna opzione scrive un file o avvia
// un programma (Out-File, Export-*, Set-Content e simili non sono letture e non stanno nella lista).
const INERTI_PS = ['get-childitem', 'gci', 'get-content', 'gc', 'get-item', 'gi', 'get-itemproperty', 'gp',
  'get-itempropertyvalue', 'get-location', 'gl', 'get-date', 'get-process', 'gps', 'get-service', 'get-help', 'get-member',
  'get-alias', 'get-variable', 'get-module', 'get-psdrive', 'get-host', 'get-command', 'get-history', 'get-computerinfo',
  'get-culture', 'get-timezone', 'get-random', 'get-unique', 'select-string', 'sls', 'select-object', 'select', 'sort-object',
  'measure-object', 'measure', 'group-object', 'group', 'compare-object', 'test-path', 'resolve-path', 'split-path', 'join-path',
  'convert-path', 'format-table', 'ft', 'format-list', 'fl', 'format-wide', 'fw', 'out-string', 'out-host', 'out-null',
  'write-output', 'write-host', 'convertto-json', 'convertfrom-json', 'convertto-csv', 'convertfrom-csv',
  'convertfrom-stringdata', 'get-filehash', 'set-location', 'sl', 'pushd', 'popd'];

test('sentinella: ogni nome delle liste di lettura sta nella tabella delle forme che scrivono o eseguono', () => {
  const { level1, ps } = C.nomiDiLettura();
  for (const nome of level1) {
    assert.ok(FORME[nome] || INERTI.includes(nome), `«${nome}» è nuovo fra le letture: scrivi qui le sue forme che scrivono o eseguono`);
  }
  for (const nome of ps) {
    assert.ok(FORME_PS[nome] || INERTI_PS.includes(nome), `«${nome}» è nuovo fra le letture di PowerShell: scrivi qui le sue forme che scrivono o eseguono`);
  }
  for (const [nome, forme] of Object.entries(FORME_PS)) {
    for (const [cmd, minimo] of forme) {
      for (const ctx of [undefined, PS]) assert.ok(C.classify(cmd, ctx) >= minimo, `${nome}: «${cmd}» deve essere almeno ${minimo}`);
    }
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
  assert.equal(C.classify('? -InputObject 1 { Start-Process calc }', PS), 3);
  // Lo stesso filtro scritto per esteso, o col punto interrogativo, vale quanto `where`.
  for (const cmd of ['Where-Object Name -like a', 'Where-Object -InputObject 1 { $_ -gt 0 }', '? -InputObject 1 { $_ -gt 0 }']) {
    assert.equal(C.classify(cmd, PS), 1, cmd);
  }
  // where.exe è il where di cmd, l'unico modo di chiamarlo da PowerShell.
  for (const cmd of ['where.exe git', 'where.exe node', 'where.exe /R . *.txt']) {
    assert.equal(C.classify(cmd, PS), C.classify(cmd.replace('where.exe', 'where'), CMD), cmd);
    assert.equal(C.classify(cmd, PS), 1, cmd);
  }
  assert.equal(C.classify('where.exe $(Start-Process calc)', PS), 3);
  assert.equal(C.classify('.\\where.exe git', PS), 3, 'un where.exe col percorso è un programma qualunque');
  // In una cartella di rete il filtro non cerca nomi; where.exe sì.
  const RETE = { ...PS, cwd: '\\\\server\\condivisa' };
  assert.equal(C.classify('where.exe git', RETE), 2);
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

// I sottocomandi di lettura di git, con le loro forme che scrivono (2) o eseguono (3). `--output` vale per tutti.
const FORME_GIT = {
  diff: [['git diff --no-index --output=Documenti/tesi.txt Documenti Documenti', 2], ['git diff --output tesi.txt', 2]],
  log: [['git log -1 --format=format:x --output=.bashrc', 2], ['git log --output Documenti/tesi.txt', 2],
    ['git log -1 --format=format:x --output=.git/config && git status', 2]],
  show: [['git show --output=Documenti/tesi.txt', 2]],
  whatchanged: [['git whatchanged --output=Documenti/tesi.txt', 2]],
  shortlog: [['git shortlog --output=Documenti/tesi.txt', 2]],
  grep: [['git grep -O"sh -c id" foo', 3], ['git grep -nOvim foo', 3], ['git grep --open-files-in-pager="sh -c id" foo', 3],
    ['git grep --open-files=true foo', 3]],
  // drop e write ci sono dalle versioni recenti di git; un verbo che il classificatore non conosce chiede.
  reflog: [['git reflog expire --expire=now --all', 3], ['git reflog delete HEAD@{0}', 3], ['git reflog drop --all', 3],
    [`git reflog write refs/heads/main ${'0'.repeat(40)} ${'a'.repeat(40)} m`, 3], ['git reflog cancella HEAD', 2]],
  'symbolic-ref': [['git symbolic-ref HEAD refs/heads/altro', 2]],
};
// Stampano e basta, a parte `--output` che vale per tutti.
const INERTI_GIT = ['status', 'rev-parse', 'describe', 'blame', 'ls-files', 'ls-tree', 'name-rev', 'cat-file', 'version', 'help',
  'count-objects'];

test('sentinella: ogni lettura di git sta nella tabella delle forme che scrivono o eseguono', () => {
  for (const nome of C.nomiDiLettura().git) {
    assert.ok(FORME_GIT[nome] || INERTI_GIT.includes(nome), `«git ${nome}» è nuovo fra le letture: scrivi qui le sue forme che scrivono o eseguono`);
  }
  const pulito = (ctx) => ctx && { ...ctx, gitLancia: () => '' };
  for (const [nome, forme] of Object.entries(FORME_GIT)) {
    for (const [comando, minimo] of forme) {
      for (const ctx of CONTESTI.map(pulito)) {
        assert.ok(C.classify(comando, ctx) >= minimo, `git ${nome}: «${comando}» deve essere almeno ${minimo}`);
        if (!ctx) continue;
        const costo = AL.costoFor({ type: 'ESEGUI_COMANDO', comando, _perimetro: ctx });
        const d = A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo, campo: 'terminale' });
        assert.notEqual(d.risposta, 'si', `«${comando}» partirebbe senza domanda`);
      }
    }
  }
  for (const cmd of ['git diff', 'git log -1 --format=format:%s', 'git show HEAD', 'git reflog', 'git reflog show',
    'git reflog list', 'git reflog exists HEAD', 'git reflog HEAD~2', 'git reflog origin/main', 'git reflog -n 5',
    'git symbolic-ref HEAD', 'git diff --output-indicator-new=+ HEAD']) {
    assert.equal(C.classify(cmd, pulito(LINUX)), 1, cmd);
  }
  // git grep chiedeva già (ricerca ricorsiva): senza il programma resta un OK, non una conferma.
  assert.equal(C.classify('git grep -n foo', pulito(LINUX)), 2);
  // Su un file che c'è già, `--output` lo sostituisce: 3, come uniq e tree.
  const esiste = (p) => (/tesi\.txt$/.test(p) ? 'file' : null);
  const d = C.classifyDetail('git log --output=Documenti/tesi.txt', { ...pulito(LINUX), esiste });
  assert.equal(d.level, 3);
  assert.match(d.motivo, /sovrascrive/);
});

test('su Windows i comandi partono con cmd che non cerca i programmi nella cartella corrente', () => {
  const prima = Object.getOwnPropertyDescriptor(process, 'platform');
  const comeWindows = (fn) => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try { return fn(); } finally { Object.defineProperty(process, 'platform', prima); }
  };
  const env = comeWindows(() => T.ambienteComandi({ PATH: 'C:\\Windows\\System32', nodefaultcurrentdirectoryinexepath: '' }));
  assert.equal(env.NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(Object.keys(env).filter((k) => k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath').length, 1);
  if (process.platform !== 'win32') assert.equal('NoDefaultCurrentDirectoryInExePath' in T.ambienteComandi({ PATH: '/bin' }), false);
});

test('quale where è lo decide un posto solo: livello e controllo della rete dicono lo stesso', () => {
  const RETE = { ...PS, cwd: '\\\\server\\condivisa' };
  for (const shell of ['powershell', 'cmd', 'bash', undefined]) {
    const ctx = { ...RETE, shell };
    const lettura = C.classify('where git', { ...PS, shell }) === 1;
    // Dove where è il filtro, in rete non cerca nomi; dove è la ricerca di cmd, li cerca e chiede.
    assert.equal(C.classify('where git', ctx), shell === 'powershell' ? 1 : 2, String(shell));
    assert.equal(lettura, true, String(shell));
  }
  assert.equal(C.classify('where.exe git', RETE), 2);
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
    'local\tinclude.path=altro', 'local\tremote.origin.uploadpack=programma', 'local\textensions.partialclone=origin',
    'local\tremote.origin.receivepack=programma', 'local\tremote.origin.vcs=programma', 'local\tremote.origin.promisor=true']) {
    assert.equal(C.gitConfigLancia(`${tipico}\n${riga}`), true, riga);
  }
  // Nella forma separata da NUL (quella della sonda) la chiave finisce al ritorno a capo: un «=» nel nome del
  // remoto non la fa passare per un'altra (`[remote "a.url=x"] promisor`).
  assert.equal(C.gitConfigLancia('local\u0000remote.a.url=x.promisor\ntrue\u0000'), true);
  assert.equal(C.gitConfigLancia('local\u0000remote.origin.url\nhttps://x\u0000local\u0000core.bare\nfalse\u0000global\u0000core.pager\nless\u0000'), false);
  assert.equal(C.gitConfigLancia('local\u0000core.fsmonitor\u0000'), false, 'una chiave senza valore vale vero');
  assert.equal(C.gitConfigLancia('worktree\u0000diff.external\nprogramma\u0000'), true);
  // Chiavi che VS Code, GitHub CLI e husky scrivono nei repository dell'utente: a una lettura non avviano niente.
  for (const riga of ['local\tbranch.main.vscode-merge-base=origin/main', 'local\tbranch.fix/x.github-pr-owner-number=a#b#1',
    'local\tremote.origin.gh-resolved=base', 'local\tcore.hookspath=.husky/_', 'local\tcore.commentchar=;']) {
    assert.equal(C.gitConfigLancia(`${tipico}\n${riga}`), false, riga);
  }
  // Le impostazioni dell'utente (globali e di sistema) sono sue: non fanno chiedere.
  assert.equal(C.gitConfigLancia('global\tdiff.external=difftool\nsystem\tfilter.lfs.clean=git-lfs clean -- %f'), false);
});

const conGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch (_) { return false; } })();
// git lancia fsmonitor con la sua shell, anche su Windows: touch c'è ovunque ci sia git.
const programmaSegno = (segno) => `touch "${segno.replace(/\\/g, '/')}"`;
// La prova vale solo se il programma del repository parte davvero quando lo lancia git.
function segnoVero(cartella, segno) {
  execFileSync('git', ['status'], { cwd: cartella, stdio: 'ignore' });
  assert.equal(existsSync(segno), true, 'il programma della prova deve creare il segno quando git lo lancia');
}

test('git: la sonda vera legge il repository della cartella, senza eseguire niente', { skip: conGit ? false : 'git non installato' }, () => {
  const base = cartellaTemporanea('filo-2292-');
  try {
    const sano = join(base, 'sano');
    const ostile = join(base, 'ostile');
    for (const d of [sano, ostile]) {
      mkdirSync(d);
      execFileSync('git', ['init', '-q'], { cwd: d, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '-q', '--allow-empty', '-m', 'i'], { cwd: d, stdio: 'ignore' });
    }
    // Un programma vero, che il segno lo crea: se la sonda lo lanciasse, la prova lo vedrebbe.
    const segno = join(base, 'SEGNO');
    execFileSync('git', ['config', 'core.fsmonitor', programmaSegno(segno)], { cwd: ostile, stdio: 'ignore' });
    assert.equal(T.gitLanciaIn(sano), '');
    assert.equal(T.gitLanciaIn(ostile), 'si');
    assert.equal(T.gitLanciaIn(join(ostile, '.git')), 'si', 'anche da dentro la cartella .git');
    assert.equal(existsSync(segno), false, 'la sonda non lancia niente');
    const ctx = { cwd: ostile, home: base, win: false, shell: 'sh', gitLancia: T.gitLanciaIn };
    assert.equal(C.classify('git status', ctx), 2);
    assert.equal(C.classify('git status', { ...ctx, cwd: sano }), 1);
    // La shell che scioglie un asterisco porta in una cartella che la sonda non vede: si chiede.
    assert.equal(C.classify('cd ostil*/ && git status', { ...ctx, cwd: base }), 2);
    assert.equal(C.classify('cd ost?le && git diff', { ...ctx, cwd: base }), 2);
    // Una cartella che la sonda non trova vuol dire che la shell entra altrove: non si sa.
    assert.equal(T.gitLanciaIn(join(base, 'non-c-e')), 'ignoto');
    assert.equal(C.classify('cd non-c-e && git status', { ...ctx, cwd: base }), 2);
    segnoVero(ostile, segno);
  } finally {
    togliCartella(base);
  }
});

// git status e git diff entrano nei sottomoduli con le loro impostazioni: la sonda le guarda tutte.
test('git: le impostazioni di un sottomodulo fanno chiedere come quelle del repository', { skip: conGit ? false : 'git non installato' }, () => {
  const base = cartellaTemporanea('filo-2292-sotto-');
  const git = (args, cwd) => execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'protocol.file.allow=always', ...args],
    { cwd, stdio: 'ignore' });
  try {
    const sub = join(base, 'sub');
    mkdirSync(sub);
    git(['init', '-q'], sub);
    git(['commit', '-q', '--allow-empty', '-m', 's'], sub);
    const nuovo = (nome) => { const d = join(base, nome); mkdirSync(d); git(['init', '-q'], d); return d; };
    // Un sottomodulo normale non fa chiedere.
    const sano = nuovo('sano');
    git(['submodule', '-q', 'add', '../sub', 'sub'], sano);
    git(['commit', '-q', '-m', 'i'], sano);
    assert.equal(T.gitLanciaIn(sano), '');
    // Le impostazioni del sottomodulo stanno nella cartella nascosta del repository principale.
    const ostile = nuovo('ostile');
    git(['submodule', '-q', 'add', '../sub', 'dentro/sub'], ostile);
    git(['commit', '-q', '-m', 'i'], ostile);
    const segno = join(base, 'SEGNO');
    git(['config', '-f', join(ostile, '.git', 'modules', 'dentro', 'sub', 'config'), 'core.fsmonitor', programmaSegno(segno)], ostile);
    assert.equal(T.gitLanciaIn(ostile), 'si');
    assert.equal(T.gitLanciaIn(join(ostile, 'dentro')), 'si', 'anche da una sottocartella');
    // Un repository annidato registrato senza .gitmodules: git status ci entra lo stesso.
    const nudo = nuovo('nudo');
    git(['clone', '-q', '../sub', 'sub'], nudo);
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(nudo, 'sub'), encoding: 'utf8' }).trim();
    git(['update-index', '--add', '--cacheinfo', `160000,${sha},sub`], nudo);
    git(['config', 'core.fsmonitor', programmaSegno(segno)], join(nudo, 'sub'));
    assert.equal(T.gitLanciaIn(nudo), 'si');
    assert.equal(existsSync(segno), false, 'la sonda non lancia niente');
    for (const cmd of ['git status', 'git diff']) {
      assert.equal(C.classify(cmd, { cwd: ostile, home: base, win: false, shell: 'sh', gitLancia: T.gitLanciaIn }), 2, cmd);
    }
    segnoVero(ostile, segno);
  } finally {
    togliCartella(base);
  }
});

test('il main dà al classificatore la sonda git, per i comandi scritti a mano e per quelli di Filo', () => {
  const h = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers.js'), 'utf8');
  const i = h.indexOf('function perimetroLettura(');
  const corpo = h.slice(i, h.indexOf('\n}\n', i));
  assert.match(corpo, /defineProperty\(perimetro, 'gitLancia'/, 'senza la sonda un repository ostile resta una lettura');
  assert.match(corpo, /gitLanciaIn\(/, 'la sonda è quella vera di terminal.js');
  // Il classificatore la riceve dal perimetro: una sonda data nel contesto cambia il livello.
  assert.equal(C.classify('git status', { ...LINUX, gitLancia: () => 'si' }), 2);
});

// #2292 — git fa partire a una LETTURA anche un programma d'avvio (hook) che un repository estratto da un archivio
// si porta dentro la cartella git, non solo le impostazioni. post-index-change lo lanciano git status e git diff a
// ogni rinfresco dell'indice; gli hook di sola scrittura (pre-commit, pre-push) non partono a una lettura.
const scriviHook = (cartellaHooks, nome, segno) => {
  const h = join(cartellaHooks, nome);
  writeFileSync(h, `#!/bin/sh\ntouch "${segno.replace(/\\/g, '/')}"\n`);
  chmodSync(h, 0o755);
};

test('git: un programma d\'avvio che una lettura fa partire fa chiedere; quelli di sola scrittura no', { skip: conGit ? false : 'git non installato' }, () => {
  const base = cartellaTemporanea('filo-2292-hook-');
  const segno = join(base, 'SEGNO');
  try {
    const repo = (nome, hook) => {
      const d = join(base, nome);
      mkdirSync(d);
      execFileSync('git', ['init', '-q'], { cwd: d, stdio: 'ignore' });
      writeFileSync(join(d, 'f'), 'a\n'); // un file tracciato: git status ne rinfresca l'indice
      execFileSync('git', ['add', 'f'], { cwd: d, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '-q', '-m', 'i'], { cwd: d, stdio: 'ignore' });
      if (hook) scriviHook(join(d, '.git', 'hooks'), hook, segno);
      return d;
    };
    const ostile = repo('ostile', 'post-index-change');
    // pre-commit e pre-push sono comuni nei repository dell'utente e non partono a una lettura: non devono far chiedere.
    const dev = repo('dev', 'pre-commit');
    const dev2 = repo('dev2', 'pre-push');
    assert.equal(T.gitLanciaIn(ostile), 'si');
    for (const d of [dev, dev2]) assert.equal(T.gitLanciaIn(d), '', 'un hook di sola scrittura non fa chiedere');
    assert.equal(existsSync(segno), false, 'la sonda non lancia niente');
    const ctx = (cwd) => ({ cwd, home: base, win: false, shell: 'sh', gitLancia: T.gitLanciaIn });
    for (const cmd of ['git status', 'git diff']) {
      assert.equal(C.classify(cmd, ctx(ostile)), 2, cmd);
      const costo = AL.costoFor({ type: 'ESEGUI_COMANDO', comando: cmd, _perimetro: ctx(ostile) });
      assert.notEqual(A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo, campo: 'terminale' }).risposta, 'si', cmd);
    }
    assert.equal(C.classify('git status', ctx(dev)), 1, 'un repository con un hook di commit resta una lettura libera');
    // Il programma parte davvero a git status: senza la sonda sarebbe codice qualunque, senza domanda.
    segnoVero(ostile, segno);
  } finally {
    togliCartella(base);
  }
});

test('git: un programma d\'avvio di lettura in un sottomodulo fa chiedere come nel repository', { skip: conGit ? false : 'git non installato' }, () => {
  const base = cartellaTemporanea('filo-2292-hook-sotto-');
  const segno = join(base, 'SEGNO');
  const git = (args, cwd) => execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'ignore' });
  try {
    const sub = join(base, 'sub');
    mkdirSync(sub);
    git(['init', '-q'], sub);
    writeFileSync(join(sub, 'f'), 'a\n');
    git(['add', 'f'], sub);
    git(['commit', '-q', '-m', 's'], sub);
    const parent = join(base, 'parent');
    mkdirSync(parent);
    git(['init', '-q'], parent);
    git(['submodule', '-q', 'add', '../sub', 'sub'], parent);
    git(['commit', '-q', '-m', 'i'], parent);
    // Nell'archivio estratto l'hook sta nella cartella git del sottomodulo, dentro il repository principale.
    scriviHook(join(parent, '.git', 'modules', 'sub', 'hooks'), 'post-index-change', segno);
    assert.equal(T.gitLanciaIn(parent), 'si');
    assert.equal(T.gitLanciaIn(join(parent, 'sub')), 'si', 'anche da dentro il sottomodulo');
    assert.equal(existsSync(segno), false, 'la sonda non lancia niente');
    assert.equal(C.classify('git status', { cwd: parent, home: base, win: false, shell: 'sh', gitLancia: T.gitLanciaIn }), 2);
    segnoVero(parent, segno);
  } finally {
    togliCartella(base);
  }
});

const nuovoRepo = (d) => {
  mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: d, stdio: 'ignore' });
  writeFileSync(join(d, 'f'), 'a\n');
  execFileSync('git', ['add', 'f'], { cwd: d, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '-q', '-m', 'i'], { cwd: d, stdio: 'ignore' });
  return d;
};

test('git: su Windows conta anche l\'hook col nome .exe, che git per Windows prova dopo il nome nudo', { skip: conGit ? false : 'git non installato' }, () => {
  const base = cartellaTemporanea('filo-2292-exe-');
  const piattaforma = Object.getOwnPropertyDescriptor(process, 'platform');
  const P = require(join(ROOT, 'src', 'main', 'services', 'programmaIntero.js'));
  const trova = P.programmaIntero;
  try {
    const repo = nuovoRepo(join(base, 'progetto'));
    writeFileSync(join(repo, '.git', 'hooks', 'post-index-change.exe'), 'MZ');
    // Windows simulato: la piattaforma e git trovato per nome (qui non c'è git.exe).
    Object.defineProperty(process, 'platform', { ...piattaforma, value: 'win32' });
    P.programmaIntero = (n) => n;
    assert.equal(T.gitLanciaIn(repo), 'si');
  } finally {
    Object.defineProperty(process, 'platform', piattaforma);
    P.programmaIntero = trova;
    togliCartella(base);
  }
});

test('git config coi verbi di git 2.46: set, unset, list e get valgono come le forme con le opzioni', () => {
  const pulito = { ...LINUX, gitLancia: () => '' };
  for (const [cmd, livello] of [['git config set remote.origin.url https://altrove.test/x.git', 3],
    ['git config set --append url.https://x.insteadof y', 3], ['git config unset user.email', 3],
    ['git config remove-section alias', 3], ['git config set user.email a@b', 2], ['git config list', 2],
    ['git config list --show-origin', 2], ['git config get remote.origin.url', 2], ['git config get --regexp user', 2],
    ['git config edit', 2], ['git config rename-section a b', 2], ['git config get user.email', 1], ['git config user.email', 1]]) {
    assert.equal(C.classify(cmd, pulito), livello, cmd);
  }
});

test('git: le chiavi che scrivono VS Code, GitHub CLI e husky non fanno chiedere una lettura', { skip: conGit ? false : 'git non installato' }, () => {
  const base = cartellaTemporanea('filo-2292-chiavi-');
  try {
    const repo = nuovoRepo(join(base, 'sito'));
    const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
    g('remote', 'add', 'origin', 'https://example.test/sito.git');
    g('config', 'branch.master.vscode-merge-base', 'origin/master');
    g('config', 'remote.origin.gh-resolved', 'base');
    g('config', 'core.hooksPath', '.husky/_');
    assert.equal(T.gitLanciaIn(repo), '');
    assert.equal(C.classify('git status', { cwd: repo, home: base, win: false, shell: 'sh', gitLancia: T.gitLanciaIn }), 1);
    // La cartella spostata si segue: un hook di lettura lì dentro fa chiedere, anche da una sottocartella.
    mkdirSync(join(repo, '.husky', '_'), { recursive: true });
    mkdirSync(join(repo, 'src'));
    scriviHook(join(repo, '.husky', '_'), 'post-index-change', join(base, 'SEGNO'));
    assert.equal(T.gitLanciaIn(join(repo, 'src')), 'si');
    // Un «=» nel nome di un remoto non nasconde la chiave che segue.
    const altro = nuovoRepo(join(base, 'altro'));
    execFileSync('git', ['config', 'remote.a.url=x.promisor', 'true'], { cwd: altro, stdio: 'ignore' });
    assert.equal(T.gitLanciaIn(altro), 'si');
  } finally {
    togliCartella(base);
  }
});

test('git: la sonda si ricorda un repository senza rischi finché i suoi file non cambiano', { skip: conGit ? false : 'git non installato' }, () => {
  const base = cartellaTemporanea('filo-2292-ricordo-');
  const P = require(join(ROOT, 'src', 'main', 'services', 'programmaIntero.js'));
  const trova = P.programmaIntero;
  // Un «git» che non risponde: se la sonda lo lancia, l'esito è 'ignoto'; se si ricorda, resta ''.
  const gitRotto = () => { P.programmaIntero = () => process.execPath; };
  try {
    const repo = nuovoRepo(join(base, 'r'));
    assert.equal(T.gitLanciaIn(repo), '');
    gitRotto();
    assert.equal(T.gitLanciaIn(repo), '', 'la seconda volta non rilancia git');
    P.programmaIntero = trova;
    // Ogni cambio che conta rifà la sonda: impostazioni, hook, un .git nuovo fra la cartella e la radice.
    execFileSync('git', ['config', 'core.fsmonitor', 'programma'], { cwd: repo, stdio: 'ignore' });
    assert.equal(T.gitLanciaIn(repo), 'si');
    const r2 = nuovoRepo(join(base, 'r2'));
    assert.equal(T.gitLanciaIn(r2), '');
    scriviHook(join(r2, '.git', 'hooks'), 'post-index-change', join(base, 'SEGNO'));
    assert.equal(T.gitLanciaIn(r2), 'si');
    const r3 = nuovoRepo(join(base, 'r3'));
    const dentro = join(r3, 'a', 'b');
    mkdirSync(dentro, { recursive: true });
    assert.equal(T.gitLanciaIn(dentro), '');
    nuovoRepo(join(r3, 'a'));
    execFileSync('git', ['config', 'core.fsmonitor', 'programma'], { cwd: join(r3, 'a'), stdio: 'ignore' });
    assert.equal(T.gitLanciaIn(dentro), 'si', 'un repository estratto più vicino prende il posto di quello ricordato');
  } finally {
    P.programmaIntero = trova;
    togliCartella(base);
  }
});

// La cartella che si dà alla sonda è quella in cui entra la shell: cmd prende il resto della riga, spazi compresi;
// `cd -P` e un secondo operando la risolvono in modi che il classificatore non ripete, e la rendono ignota.
test('git: dopo un cd la sonda guarda la cartella in cui entra davvero la shell', () => {
  const visti = [];
  const sonda = (esito) => (d) => { visti.push(d); return esito(d); };
  const cmdCtx = (esito) => ({ ...CMD, cwd: 'C:\\Users\\Mario\\Downloads', gitLancia: sonda(esito) });
  const progetto = 'c:\\users\\mario\\downloads\\progetto mario';
  const ostileSpazio = (d) => (d.toLowerCase() === progetto ? 'si' : '');
  assert.equal(C.classify('cd Progetto Mario && git status', cmdCtx(ostileSpazio)), 2);
  assert.ok(visti.some((d) => d.toLowerCase() === progetto), visti.join(' | '));
  assert.equal(C.classify('chdir /d Progetto Mario && git diff', cmdCtx(ostileSpazio)), 2);
  assert.equal(C.classify('cd Progetto Mario && git status', cmdCtx(() => '')), 1, 'pulita, resta una lettura');
  const pulito = { ...LINUX, gitLancia: () => '' };
  for (const cmd of ['cd -P Downloads/arc/l/.. && git status', 'cd -LP x && git status', 'cd a b && git status']) {
    assert.equal(C.classify(cmd, pulito), 2, cmd);
  }
  assert.equal(C.classify('cd -L Downloads && git status', pulito), 1);
  assert.equal(C.classify('Set-Location Downloads -PassThru; git status', { ...PS, gitLancia: () => '' }), 1);
});

test('git: le chiavi che git-lfs, la manutenzione, git-flow e le istruzioni comuni scrivono non fanno chiedere', () => {
  for (const riga of ['lfs.https://example.test/a.git/info/lfs.access=basic', 'lfs.https://example.test/a.git/info/lfs.locksverify=true',
    'maintenance.auto=false', 'maintenance.strategy=incremental', 'blame.ignorerevsfile=.git-blame-ignore-revs',
    'gitflow.branch.master=main', 'gitflow.prefix.feature=feature/', 'commit.gpgsign=true', 'gc.auto=0', 'alias.st=status',
    'remote.pushdefault=origin', 'branch.autosetuprebase=always', 'diff.algorithm=histogram', 'log.decorate=short',
    'status.showuntrackedfiles=no', 'submodule.recurse=true', 'merge.tool=meld', 'rerere.enabled=true']) {
    assert.equal(C.gitConfigLancia(`local\t${riga}`), false, riga);
  }
  // Queste avviano un programma a una lettura (o a una pulizia di lfs che git status chiede): chiedono ancora.
  for (const riga of ['diff.external=x', 'diff.pdf.textconv=x', 'log.showsignature=true', 'gpg.program=x',
    'lfs.extension.x.clean=x', 'core.pager=x', 'submodule.a.update=!x']) {
    assert.equal(C.gitConfigLancia(`local\t${riga}`), true, riga);
  }
});

test('git blame --contents legge un file qualsiasi: un file privato chiede come con cat', () => {
  for (const ctx of [LINUX, MAC]) {
    for (const cmd of ['git blame --contents ~/.ssh/id_rsa README', 'git blame --contents=~/.netrc f']) {
      assert.equal(C.classify(cmd, ctx), C.classify('cat ~/.ssh/id_rsa', ctx), cmd);
      assert.ok(C.classify(cmd, ctx) >= 2, cmd);
    }
  }
  assert.ok(C.classify('git blame --contents $HOME\\.ssh\\id_rsa README', PS) >= 2);
  assert.equal(C.classify('git blame --contents nuovo.txt README', LINUX), 1);
});
