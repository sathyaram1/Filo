// #2619.5 — impostazioni e hook di git scelgono il programma che parte al prossimo comando git: scriverli con una copia,
// uno spostamento o `git config` vale quanto la redirezione sullo stesso file (3, si digita «conferma»).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants.js', 'contenutoEsterno.js', 'capabilities.js', 'themeTokens.js', 'cmdClassify.js',
  'zoomPagina.js', 'autonomia.js', 'preferences.js', 'actionLevels.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const C = globalThis.SN_CMD_CLASSIFY;
const A = globalThis.SN_AUTONOMIA;
const AL = globalThis.SN_ACTION_LEVELS;

// La sonda del disco del main: qui nessun file c'è già, come un hook nuovo o un ~/.gitconfig che manca.
const nessuno = () => null;
const LINUX = { cwd: '/home/mario/sito', home: '/home/mario', win: false, shell: 'sh', esiste: nessuno };
const MAC = { cwd: '/Users/mario/sito', home: '/Users/mario', win: false, maiuscole: true, shell: 'sh', esiste: nessuno };
const PS = { cwd: 'C:\\Users\\Mario\\sito', home: 'C:\\Users\\Mario', win: true, maiuscole: true, shell: 'powershell', esiste: nessuno };
const CMD = { ...PS, shell: 'cmd' };
const CONTESTI = [['senza contesto', undefined], ['linux', LINUX], ['mac', MAC], ['powershell', PS], ['cmd', CMD]];

const decisione = (comando, ctx) => A.decideDettaglio({
  livello: 'default', stato: 'contaminato', campo: 'terminale',
  costo: AL.costoFor({ type: 'ESEGUI_COMANDO', comando, _perimetro: ctx }),
});

test('i passi della segnalazione: la copia sopra impostazioni e hook di git chiede «conferma» come la redirezione', () => {
  const posix = ['cp evil.cfg .git/config', 'mv evil.cfg .git/config', 'cp evil.sh .git/hooks/pre-commit',
    'cp evil.cfg ~/.gitconfig', 'echo x >> .git/config'];
  for (const [nome, ctx] of CONTESTI.filter(([n]) => n !== 'cmd')) {
    for (const cmd of posix) {
      const d = C.classifyDetail(cmd, ctx);
      assert.equal(d.level, 3, `${nome}: «${cmd}»`);
      if (!ctx) continue;
      assert.equal(decisione(cmd, ctx).digita, true, `${nome}: «${cmd}» deve far digitare «conferma»`);
    }
  }
  for (const cmd of ['copy evil.cfg .git\\config', 'move evil.cfg .git\\config', 'copy evil.sh .git\\hooks\\pre-commit',
    'copy evil.cfg %USERPROFILE%\\.gitconfig']) {
    assert.equal(C.classify(cmd, CMD), 3, `cmd: «${cmd}»`);
  }
  assert.match(C.classifyDetail('cp evil.sh .git/hooks/pre-commit', LINUX).motivo, /git/);
});

test('ogni strada verso gli stessi file: programmi, opzioni, cartella di lavoro, jolly e nomi che la shell riscrive', () => {
  const casi = ['ln -s evil.sh .git/hooks/pre-commit', 'cp -t .git/hooks evil', 'cp --target-directory=.git/hooks pre-commit',
    'tar -C .git/hooks -xf a.tar', 'unzip a.zip -d .git', 'mv evilrepo .git', 'cp evil.cfg ~/.config/git/config',
    'cp evil /etc/gitconfig', 'cp x ../server/repo.git/hooks/post-receive', 'cp evil .gi?/config', 'cp evil .git/{config,x}',
    'cp evil "$HOME/.gitconfig"', 'cp x .GIT/CONFIG', 'cd .git && cp evil config', 'cd .git/hooks; cp evil pre-commit',
    'mkdir -p .git/hooks && cp evil .git/hooks/post-checkout'];
  for (const [nome, ctx] of CONTESTI) {
    for (const cmd of casi) assert.equal(C.classify(cmd, ctx), 3, `${nome}: «${cmd}»`);
  }
  for (const cmd of ['copy evil GIT~1\\config', 'robocopy evil .git\\hooks pre-commit', 'xcopy evil .git\\hooks\\ /Y',
    'copy evil "C:\\Program Files\\Git\\etc\\gitconfig"', 'cd .git\\hooks & copy evil.sh', 'copy evil .git\\config::$DATA']) {
    assert.equal(C.classify(cmd, CMD), 3, `cmd: «${cmd}»`);
  }
});

test('git config: una chiave che sceglie un programma vale 3, come `git -c`', () => {
  const tre = ['git config core.sshCommand ./evil.sh', 'git config set core.pager ./evil.sh',
    'git config --global core.editor vim', 'git config --file .git/config core.sshCommand x',
    'git config -f .git/config remote.origin.url https://altrove.test/r.git', 'git config core.hooksPath strani',
    'git config --global init.templateDir modelli', 'git config merge.x.driver ./evil.sh', 'git config include.path altro.cfg',
    'git config --global --add credential.helper ./evil.sh', 'git config core.fsmonitor ./evil.sh',
    'git config --type bool core.sshCommand y', 'git config --rename-section pull core', 'git config rename-section pull core'];
  const due = ['git config user.name Mario', 'git config --global user.email a@b.c', 'git config pull.rebase true',
    'git config --global core.autocrlf false', 'git config core.fsmonitor true', 'git config --add safe.directory /x',
    'git config branch.main.remote origin', 'git config set user.email a@b'];
  for (const [nome, ctx] of CONTESTI) {
    const pulito = ctx && { ...ctx, gitLancia: () => '' };
    for (const cmd of tre) assert.equal(C.classify(cmd, pulito), 3, `${nome}: «${cmd}»`);
    for (const cmd of due) assert.equal(C.classify(cmd, pulito), 2, `${nome}: «${cmd}»`);
  }
  assert.equal(C.classify('git config --get core.sshCommand', { ...LINUX, gitLancia: () => '' }), 1, 'leggere resta lettura');
});

test('le copie di tutti i giorni restano a conferma leggera', () => {
  for (const [nome, ctx] of CONTESTI) {
    for (const cmd of ['cp a.txt b.txt', 'cp *.txt backup/', 'cp -r * ../copia', 'mv * archivio/', 'touch .gitignore',
      'cp ci.yml .github/workflows/ci.yml', 'mv x .gitattributes', 'mkdir src', 'cp x foo.git']) {
      assert.equal(C.classify(cmd, ctx), 2, `${nome}: «${cmd}»`);
    }
  }
});
