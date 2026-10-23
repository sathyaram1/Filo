// Il perimetro di lettura (#587): una lettura del terminale o un documento resta
// livello 1 solo nella cartella personale, fuori da file nascosti e profilo; il
// resto (altri percorsi, variabili d'ambiente, processi) chiede un OK.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = join(__dirname, '..', '..', 'src', 'shared');
require(join(shared, 'preferences.js'));
require(join(shared, 'themeTokens.js'));
require(join(shared, 'cmdClassify.js'));
require(join(shared, 'zoomPagina.js'));
require(join(shared, 'actionLevels.js'));

const C = globalThis.SN_CMD_CLASSIFY;
const AL = globalThis.SN_ACTION_LEVELS;

const LINUX = { cwd: '/home/mario', home: '/home/mario', win: false, maiuscole: false };
const MAC = { cwd: '/Users/mario', home: '/Users/mario', win: false, maiuscole: true };
const WIN = { cwd: 'C:\\Users\\Mario', home: 'C:\\Users\\Mario', win: true, maiuscole: true };

const lvl = (cmd, ctx) => C.classify(cmd, ctx);

test('printenv e le variabili d\'ambiente non sono livello 1', () => {
  for (const cmd of [
    'printenv', 'printenv PATH', 'echo $OPENAI_API_KEY', 'echo "$AWS_SECRET_ACCESS_KEY"', 'echo %GITHUB_TOKEN%',
    'Write-Output $env:OPENAI_API_KEY', 'Get-ChildItem env:', 'gci Env:\\', 'Get-Item Env:PATH',
    'dir env:', 'ls $API_KEY', 'cat $TOKEN/nota.txt', 'cd $SEGRETO', 'Set-Location Env: ; Get-ChildItem',
  ]) {
    for (const ctx of [undefined, LINUX, WIN]) {
      assert.notEqual(lvl(cmd, ctx), 1, `"${cmd}" non deve leggere l'ambiente senza chiedere`);
      assert.notEqual(lvl(cmd, ctx), 3, `"${cmd}" è una lettura: basta un OK, non «conferma»`);
    }
  }
  // Senza espansione resta tutto com'era.
  assert.equal(lvl('echo ciao', LINUX), 1);
  assert.equal(lvl("grep '^fine$' note.txt", LINUX), 1);
  assert.equal(lvl("echo '$HOME'", LINUX), 1, 'fra apici singoli `$` non si espande');
  assert.equal(lvl('date +%H:%M', LINUX), 1, 'il formato di date non è una variabile');
  // La cartella personale scritta con una variabile resta la cartella personale.
  assert.equal(lvl('cat $HOME/nota.txt', LINUX), 1);
  assert.equal(lvl('cat "$HOME/.ssh/id_rsa"', LINUX), 2);
  assert.equal(lvl('Get-ChildItem "$env:USERPROFILE\\Downloads" -Filter *.pdf', WIN), 1);
  assert.equal(lvl('Get-Content $env:USERPROFILE\\.ssh\\id_rsa', WIN), 2);
  assert.equal(lvl('type %USERPROFILE%\\Desktop\\nota.txt', WIN), 1);
  assert.equal(lvl('echo $env:USERNAME', WIN), 1);
  assert.equal(lvl('Get-ChildItem | Sort-Object { $_.Length }', WIN), 1);
});

test('ps e l\'elenco dei processi chiedono un OK (righe di comando e ambiente degli altri)', () => {
  for (const cmd of ['ps', 'ps aux', 'ps eww', 'Get-Process', 'gps', 'w',
    'Get-Process | Sort-Object CPU | Select-Object -First 3']) {
    assert.equal(lvl(cmd, LINUX), 2, cmd);
  }
  assert.match(C.classifyDetail('ps aux', LINUX).motivo, /programmi/);
});

test('lettura dentro la cartella personale: resta livello 1', () => {
  for (const cmd of [
    'cat note.txt', 'cat ~/Documenti/lettera.txt', 'head -n 20 ~/Scaricati/log.txt',
    'tail -f progetto/out.log', 'grep fattura Documenti/elenco.txt', 'cat file | grep errore',
    'cd Documenti && cat lettera.txt', 'cd ~/Documenti && cat "lettera per mamma.txt"',
    'git log --oneline | head -n 20', 'git show HEAD:src/app.js', 'ls ~/.ssh', 'ls -la /etc',
  ]) {
    assert.equal(lvl(cmd, LINUX), 1, cmd);
  }
  for (const cmd of [
    'type Documents\\lettera.txt', 'Get-Content C:\\Users\\Mario\\Desktop\\a.txt',
    'gc c:\\users\\mario\\documents\\a.txt', 'Select-String fattura -Path Documents\\a.txt',
    'Get-Content log.txt | Select-String errore', 'Get-ChildItem C:\\Windows',
  ]) {
    assert.equal(lvl(cmd, WIN), 1, cmd);
  }
});

test('lettura fuori perimetro: chiede un OK (livello 2), mai silenziosa', () => {
  const casi = {
    linux: [LINUX, [
      'cat ~/.ssh/id_rsa', 'cat .ssh/id_rsa', 'cat ~/.bashrc', 'cat /etc/passwd',
      'head ../../etc/shadow', 'cat ~/Documenti/../.aws/credentials', 'tail -n 5 ~/.config/filo/x',
      'cat /proc/self/environ', 'cat ~root/.profile', 'grep -r password .', 'grep -rn TOKEN ~/progetto',
      'grep -f ~/.ssh/id_rsa x.txt', 'cat ~/?ssh/id_rsa', 'cat ~/[.]ssh/id_rsa', 'cat ~/{.ssh,x}/id_rsa',
      'cat ~/*', 'cd ~/.ssh && cat id_rsa', 'cd /etc; cat passwd', 'cd .ssh || cat id_rsa',
      'git show HEAD:.env', 'git diff --no-index /dev/null ~/.ssh/id_rsa', 'git grep -e password',
      'ls | cat', 'cut -d: -f1 /etc/passwd',
    ]],
    windows: [WIN, [
      'type AppData\\Roaming\\x\\token.json', 'type "Application Data\\Microsoft\\x"',
      'Get-Content C:\\Users\\Mario\\.ssh\\id_rsa', 'gc ~\\.ssh\\id_rsa', 'type SSH~1\\id_rsa',
      'type ..\\Luigi\\Desktop\\a.txt', 'type D:\\bollette\\x.txt', 'type \\\\server\\share\\x',
      'Get-Content $env:USERPROFILE\\.ssh\\id_rsa', 'Get-ItemProperty HKCU:\\Software\\x',
      'Get-ChildItem | Select-String password', 'gci -Recurse | gc', 'findstr /s password *.txt',
      'findstr /f:elenco.txt x', 'type C:x.txt', 'type /mnt/c/Users/Mario/.ssh/id_rsa',
      'Get-Content NTUSER.DAT', 'type AppData.\\Roaming\\x',
    ]],
    mac: [MAC, ['cat ~/Library/Cookies/x', 'cat ~/library/keychains/x', 'cat ~/.zsh_history']],
  };
  for (const [nome, [ctx, cmds]] of Object.entries(casi)) {
    for (const cmd of cmds) {
      const d = C.classifyDetail(cmd, ctx);
      assert.equal(d.level, 2, `${nome}: "${cmd}" deve chiedere un OK (è ${d.level})`);
      assert.ok(d.motivo, `${nome}: "${cmd}" deve dire perché chiede`);
    }
  }
});

test('leggere i propri file con un jolly resta libero; il jolly-cartella no (#587 giro 10)', () => {
  // La lettura di tutti i giorni: un jolly con estensione, ultimo pezzo del
  // percorso, prende solo file visibili con quell'estensione → livello 1.
  for (const cmd of [
    'cat *.txt', 'head -3 *.csv', 'cat Documenti/*.csv', 'head -n 5 Scaricati/report-*.log',
    'cat appunti-*.md', 'tail progetto/build/*.txt',
  ]) {
    assert.equal(lvl(cmd, LINUX), 1, cmd);
  }
  for (const cmd of ['type *.txt', 'Get-Content Documents\\*.csv', 'gc note-*.log']) {
    assert.equal(lvl(cmd, WIN), 1, cmd);
  }
  // Restano da confermare: un jolly nudo (prende tutto, `_netrc` compreso), un
  // jolly che fa da CARTELLA (può essere `.ssh`, `AppData`), le classi/graffe.
  for (const cmd of [
    'cat *', 'cat ~/*', 'cat *.*', 'cat ?ssh/id_rsa', 'cat *ssh/config',
    'cat Documenti/*/segreto', 'cat [.]ssh/id_rsa', 'cat {.ssh,x}/id_rsa',
  ]) {
    assert.equal(lvl(cmd, LINUX), 2, cmd);
  }
});

test('la cartella di lavoro conta dove porta, non come ci si è arrivati', () => {
  const inSsh = { ...LINUX, cwd: '/home/mario/.ssh' };
  assert.equal(lvl('cat id_rsa', inSsh), 2, 'cwd già dentro ~/.ssh');
  assert.equal(lvl('ls', inSsh), 1, 'elencare i nomi resta libero');
  // Un `cd` che fallisce lascia la cartella di prima: anche quella va valutata.
  assert.equal(lvl('cd ~/Documenti/nuova || cat id_rsa', inSsh), 2);
  assert.equal(lvl('cd - && cat x.txt', LINUX), 2, 'cartella che non si sa prima');
  const fuori = { ...LINUX, cwd: '/srv/dati' };
  assert.equal(lvl('cat report.txt', fuori), 2);
  // Contesto rotto (home che manca): nessuna lettura passa senza chiedere.
  assert.equal(lvl('cat note.txt', { cwd: '/home/mario', home: '' }), 2);
});

test('il livello di base non scende: scritture e comandi ignoti restano dove erano', () => {
  assert.equal(lvl('rm -rf ~/Documenti', LINUX), 3);
  assert.equal(lvl('cat ~/.ssh/id_rsa > /tmp/x', LINUX), 3);
  assert.equal(lvl('cp ~/.ssh/id_rsa x', LINUX), 2);
  assert.equal(lvl('curl https://example.com', LINUX), 2);
});

test('ESEGUI_COMANDO: il registro usa il perimetro iniettato dal main e lo spiega nel popup', () => {
  const a = { type: 'ESEGUI_COMANDO', comando: 'cat ~/.ssh/id_rsa', _perimetro: LINUX, _cwd: '~' };
  assert.equal(AL.costoFor(a), 2);
  assert.match(AL.describe(a), /Perché te lo chiedo: legge un file nascosto o di configurazione/);
  const ok = { type: 'ESEGUI_COMANDO', comando: 'cat note.txt', _perimetro: LINUX };
  assert.equal(AL.costoFor(ok), 1);
  assert.doesNotMatch(AL.describe(ok), /Perché/);
});

test('LEGGI_DOCUMENTO: stesso perimetro del terminale', () => {
  const doc = (percorso, ctx = LINUX) => AL.costoFor({ type: 'LEGGI_DOCUMENTO', percorso, _perimetro: ctx });
  assert.equal(doc('~/Scaricati/estratto.pdf'), 0);
  assert.equal(doc('bolletta.pdf'), 0);
  assert.equal(doc('"~/Documenti/contratto affitto.pdf"'), 0);
  assert.equal(doc('~/.ssh/id_rsa'), 2);
  assert.equal(doc('/etc/shadow'), 2);
  assert.equal(doc('~/.config/chiavi.txt'), 2);
  assert.equal(doc('D:\\bollette\\luce.pdf', WIN), 2);
  assert.equal(doc('AppData\\Roaming\\x\\token.txt', WIN), 2);
  const a = { type: 'LEGGI_DOCUMENTO', percorso: '~/.aws/credentials', _perimetro: LINUX };
  assert.match(AL.describe(a), /Perché te lo chiedo/);
});

test('#587 giro 11 — scritture equivalenti del percorso non aggirano il perimetro', () => {
  // bash `$'…'`/`$"…"`: il $ è prefisso di quoting, la stringa torna com'è.
  assert.equal(lvl("cat $'.ssh/config'", LINUX), 2);
  assert.equal(lvl('cat $".ssh/config"', LINUX), 2);
  assert.equal(lvl("cat $'.config/Filo/storage.json'", LINUX), 2);
  assert.equal(lvl("head $'.ssh/id_rsa'", LINUX), 2);
  assert.equal(lvl("cd $'.ssh' && cat config", LINUX), 2);
  assert.equal(lvl("cat $'/etc/shadow'", LINUX), 2);
  assert.equal(lvl("cat $'Library/Application Support/Filo/storage.json'", MAC), 2);
  // Le stesse virgolette per un file legittimo con spazio dentro restano libere.
  assert.equal(lvl("cat $'nota di spesa.txt'", LINUX), 1);
  assert.equal(lvl("cat $'Documenti/nota di spesa.txt'", LINUX), 1);

  // PowerShell lega un parametro col due punti: `-Path:valore`.
  assert.equal(lvl('Get-Content -Path:.ssh\\config', WIN), 2);
  assert.equal(lvl('Get-Content -LiteralPath:.ssh\\config', WIN), 2);
  assert.equal(lvl('Get-Content -Path:AppData\\Roaming\\Filo\\storage.json', WIN), 2);
  assert.equal(lvl('Select-String -Path:.ssh\\config Host', WIN), 2);
  assert.equal(lvl('Get-ChildItem -Path:env:', WIN), 2);
  assert.equal(lvl('Get-ItemProperty -Path:HKCU:\\Software\\x', WIN), 2);
  assert.equal(lvl('Get-Content -Path:Documenti\\a.txt', WIN), 1);

  // La virgola in PowerShell costruisce un array di percorsi: si guardano tutti.
  assert.equal(lvl('Get-Content Documenti\\a.txt,.ssh\\config', WIN), 2);
  assert.equal(lvl('Get-Content Documenti\\a.txt,AppData\\Roaming\\Filo\\storage.json', WIN), 2);
  assert.equal(lvl('Get-ChildItem Documenti,env:', WIN), 2);
  assert.equal(lvl('Get-Content rel,finale.txt', WIN), 1);
});

// #1511 — sh e bash decodificano `$'…'` e tolgono i backslash: il perimetro misura il percorso che vede la shell.
test('#1511 — il perimetro legge `$\'…\'` e i backslash come sh e bash', () => {
  const nascosto = /legge un file nascosto o di configurazione/;
  const det = (cmd, ctx) => C.classifyDetail(cmd, ctx);
  const punti = ['\\x2e', '\\056', '\\u002e'];
  for (const ctx of [LINUX, MAC, { ...LINUX, shell: 'sh' }, { ...MAC, shell: 'bash' }]) {
    for (const prog of ['cat', 'head']) {
      for (const pre of ['~/', './']) {
        for (const p of punti) {
          const cmd = `${prog} ${pre}$'${p}ssh/config'`;
          assert.equal(det(cmd, ctx).level, 2, cmd);
          assert.match(det(cmd, ctx).motivo, nascosto, cmd);
        }
        // Il punto scritto da solo nell'escape, col resto del nome fuori dalle virgolette.
        assert.equal(lvl(`${prog} ${pre}$'\\x2e'aws/credentials`, ctx), 2);
        // Il backslash fuori dalle virgolette sparisce: `.\ssh` è `.ssh`.
        assert.equal(lvl(`${prog} ${pre}.\\ssh/config`, ctx), 2);
      }
    }
  }
  // Library su Mac, con una lettera scritta come escape o dopo un backslash.
  assert.equal(lvl("cat $'Libr\\x61ry/Application Support/Filo/storage.json'", MAC), 2);
  assert.equal(lvl("cat ~/$'\\x4c'ibrary/Keychains/login.keychain-db", MAC), 2);
  assert.equal(lvl('cat ~/Lib\\rary/Keychains/login.keychain-db', MAC), 2);
  // Un ottale oltre 377 vale il suo byte basso, come in bash: `\456` è il punto.
  assert.equal(lvl("cat ~/$'\\456ssh/config'", LINUX), 2);
  // `\'` dentro `$'…'` non chiude la stringa: il percorso dopo è un argomento a sé.
  assert.equal(lvl("cat a$'\\''b /etc/passwd", LINUX), 2);
  // Un apice o una virgoletta col backslash davanti non apre niente.
  assert.equal(lvl('cat a\\"x /etc/passwd \\"', LINUX), 2);

  // Il popup che l'utente vede prima della lettura.
  const a = { type: 'ESEGUI_COMANDO', comando: "cat ~/$'\\x2essh/id_rsa'", _perimetro: LINUX, _cwd: '~' };
  assert.equal(AL.costoFor(a), 2);
  assert.match(AL.describe(a), /Perché te lo chiedo: legge un file nascosto o di configurazione/);
  assert.equal(AL.costoFor({ ...a, comando: 'cat ~/.\\ssh/id_rsa' }), 2);

  // Escape sconosciuti, NUL e byte che non sono UTF-8: il percorso non si sa.
  for (const cmd of ["cat $'\\qnota.txt'", "cat ~/$'\\x00'nota.txt", "cat $'\\xffnota.txt'", "cat $'\\xnota.txt'",
    "cat $'\\unota.txt'", "cat $'\\U110000'", "cat $'\\ud800'", "cat $'nota.txt"]) {
    const d = det(cmd, LINUX);
    assert.equal(d.level, 2, cmd);
    assert.match(d.motivo, /non si sa prima quali file leggerà/, cmd);
  }

  // Le stesse scritture per un file visibile restano libere.
  assert.equal(lvl("cat $'nota\\x20di\\x20spesa.txt'", LINUX), 1);
  assert.equal(lvl("cat ~/$'Documenti/nota\\040di spesa.txt'", MAC), 1);
  assert.equal(lvl("cat $'\\u00e8 tutto.txt'", LINUX), 1);
  assert.equal(lvl("cat $'\\xc3\\xa8 tutto.txt'", LINUX), 1);
  assert.equal(lvl('cat nota\\ di\\ spesa.txt', LINUX), 1);
  assert.equal(lvl('cat "Documenti/nota \\"vecchia\\".txt"', LINUX), 1);
  assert.equal(lvl("echo $'\\xff'", LINUX), 1, 'echo stampa e basta');
  assert.equal(lvl("grep $'ciao\\tmondo' note.txt", LINUX), 1);
  assert.equal(lvl('cat $"nota di spesa.txt"', LINUX), 1);
  assert.equal(lvl("echo '$HOME'", LINUX), 1);
  assert.equal(lvl("echo $'$HOME'", LINUX), 1, 'dentro `$\'…\'` il `$` non si espande');
});

test('#1511 — git, cd e le altre shell misurano gli stessi percorsi', () => {
  // git apre i file di `--no-index` come cat: stessa lettura degli argomenti.
  for (const cmd of ["git diff --no-index $'.ssh/config' a.txt", "git diff --no-index ~/$'\\x2essh'/config a.txt",
    'git diff --no-index ~/.\\ssh/config a.txt', 'git diff --no-index $".ssh/config" a.txt']) {
    assert.equal(lvl(cmd, LINUX), 2, cmd);
  }
  assert.equal(lvl('git diff --no-index "Documenti/a b.txt" Documenti/c.txt', LINUX), 1);
  assert.equal(lvl('git diff', LINUX), 1);
  // Un `cd` scritto così porta dove porta la shell; uno che non si decodifica rende ignota la cartella.
  assert.equal(lvl("cd ~/$'\\x2essh' && cat config", LINUX), 2);
  assert.equal(lvl('cd ~/.\\ssh && cat config', LINUX), 2);
  assert.equal(lvl("cd $'\\xff' && ls", LINUX), 2);
  assert.equal(lvl("cd $'Documenti' && cat nota.txt", LINUX), 1);
  // bash su Windows decodifica come altrove; PowerShell e cmd no: lì `\` separa le cartelle.
  assert.equal(lvl("cat ~/$'\\x2essh'/config", { ...WIN, shell: 'bash' }), 2);
  assert.equal(lvl('Get-Content .\\Documenti\\a.txt', WIN), 1);
  assert.equal(lvl('Get-Content .\\Documenti\\a.txt', { ...WIN, shell: 'powershell' }), 1);
  assert.equal(lvl('type Documenti\\a.txt', { ...WIN, shell: 'cmd' }), 1);
  assert.equal(lvl('Get-Content AppData\\Roaming\\Filo\\storage.json', { ...WIN, shell: 'powershell' }), 2);
});

test('#1511 — dove sh può essere dash, `\\\'` dentro `$\'…\'` chiude la stringa: anche quella lettura chiede', () => {
  // dash: `cat '$a\' .ssh/id_rsa` legge la chiave; bash vede un nome solo. Vale il più severo dei due.
  for (const ctx of [LINUX, MAC, { ...LINUX, shell: 'sh' }]) {
    for (const cmd of ["cat $'a\\' .ssh/id_rsa #'", "head $'x\\' .ssh/id_rsa ''", "grep $'a\\' .netrc #'",
      "head -n $'1\\' .ssh/id_rsa #'", "cat $'a\\c\\' .ssh/id_rsa #'"]) {
      assert.equal(lvl(cmd, ctx), 2, `${cmd} ${JSON.stringify(ctx)}`);
    }
  }
  // Con bash scelta apposta la lettura è una sola.
  assert.equal(lvl("cat $'a\\' .ssh/id_rsa #'", { ...LINUX, shell: 'bash' }), 1);
  assert.equal(lvl("cat $'it\\'s.txt'", LINUX), 1);
  // `\c\` è 0x1c e la barra dopo resta un separatore, come in bash: la cartella nascosta si vede.
  assert.equal(lvl("cat ~/$'\\c\\/.ssh/config'", { ...LINUX, shell: 'bash' }), 2);
  assert.equal(lvl("cat $'\\c\\\\nota.txt'", { ...LINUX, shell: 'bash' }), 1);
});

// #1072 — un percorso di rete (UNC, `\\?\UNC\`, `//server`) fa aprire a Windows una connessione verso
// quel computer: anche una sola lettura di nomi chiede un OK, e il popup dice perché. Gemello: #810.13.
test('#1072 — le letture su un percorso di rete chiedono un OK col motivo «rete»', () => {
  const rete = /altro computer della rete/;
  for (const cmd of [
    'cd \\\\host\\x', 'chdir \\\\host\\x', 'pushd \\\\host\\x', 'Set-Location \\\\host\\x', 'sl -Path \\\\host\\x',
    'Set-Location -LiteralPath:"\\\\host\\x"', 'Test-Path \\\\host\\x', 'Get-ChildItem \\\\host', 'gci -Path \\\\host\\x',
    'dir \\\\host\\x', 'ls //host/x', 'Get-FileHash \\\\host\\x', 'Get-Item \\\\host\\x', 'Resolve-Path \\\\host\\x',
    'tree \\\\host\\x', 'Get-ChildItem \\\\?\\UNC\\host\\x', 'ls Documents,\\\\host\\x', 'cd "\\\\host\\x"',
    'gc \\\\host\\x', 'type \\\\host\\x', 'Select-String a -Path \\\\host\\x', 'grep --file=\\\\host\\x a.txt',
    'echo \\\\host\\x | Test-Path', 'Test-Path (Join-Path "\\\\host" "x")', 'cd \\\\host\\x; ls',
  ]) {
    for (const ctx of [WIN, undefined]) {
      const d = C.classifyDetail(cmd, ctx);
      assert.equal(d.level, 2, `"${cmd}" non deve contattare un altro computer senza chiedere`);
      assert.match(d.motivo, rete, `"${cmd}": il popup dice che si va in rete`);
    }
  }
  // Il disco locale resta libero, anche scritto con il prefisso dei percorsi lunghi.
  for (const cmd of ['cd C:\\Windows', 'ls C:\\Windows', 'Get-ChildItem C:\\Windows', 'dir \\\\?\\C:\\Windows',
    'Test-Path Documents', 'cd ..', 'echo ciao', 'echo https://example.com/a']) {
    assert.equal(lvl(cmd, WIN), 1, cmd);
  }
  // Su macOS `/net/<host>` monta le cartelle condivise di quel computer.
  assert.equal(lvl('ls /net/host/x', MAC), 2);
  assert.equal(lvl('ls /net', MAC), 1);
});

test('#1072 — con la cartella di lavoro in rete ogni percorso relativo va in rete', () => {
  const inRete = { ...WIN, cwd: '\\\\host\\x' };
  for (const cmd of ['ls', 'dir', 'Get-ChildItem', 'ls foo', 'cd foo', 'cd ..', 'Test-Path foo', 'cat a.txt', 'gc \\a.txt']) {
    const d = C.classifyDetail(cmd, inRete);
    assert.equal(d.level, 2, cmd);
    assert.match(d.motivo, /rete/, cmd);
  }
  assert.equal(lvl('ls C:\\Users\\Mario\\Documents', inRete), 1, 'un percorso locale intero resta libero');
  assert.equal(lvl('echo ciao', inRete), 1);
});

test('#1072 — un percorso preso dal contenuto di un file chiede un OK; i valori scritti nel comando no', () => {
  for (const cmd of ['gc elenco.txt | Test-Path', 'Get-Content elenco.txt | Get-ChildItem', 'gc elenco.txt | cd',
    'Test-Path (gc elenco.txt)', 'cd (Get-Content elenco.txt)', 'Get-FileHash (gc elenco.txt)']) {
    assert.equal(lvl(cmd, WIN), 2, cmd);
  }
  for (const cmd of ['Test-Path (Join-Path $env:USERPROFILE "Downloads")', 'gci | Get-FileHash',
    'Get-ChildItem Downloads | Select-Object -First 3 | Get-FileHash', 'Get-Content log.txt | Select-String errore',
    'cat a.txt | wc -l']) {
    assert.equal(lvl(cmd, WIN), 1, cmd);
  }
});

test('#1072 — LEGGI_DOCUMENTO e il popup del terminale dicono che si va in rete', () => {
  const doc = { type: 'LEGGI_DOCUMENTO', percorso: '\\\\host\\x\\a.pdf', _perimetro: WIN };
  assert.equal(AL.costoFor(doc), 2);
  assert.match(AL.describe(doc), /Perché te lo chiedo: si collega a un altro computer della rete/);
  assert.equal(AL.costoFor({ ...doc, percorso: 'a.pdf', _perimetro: { ...WIN, cwd: '\\\\host\\x' } }), 2);
  const cmd = { type: 'ESEGUI_COMANDO', comando: 'Test-Path \\\\host\\x', _perimetro: WIN };
  assert.equal(AL.costoFor(cmd), 2);
  assert.match(AL.describe(cmd), /Perché te lo chiedo: si collega a un altro computer della rete/);
});

test('#1072 — due barre senza il nome di un computer non sono un percorso di rete', () => {
  for (const cmd of ['grep -n "// TODO" app.js', 'grep "//" app.js', 'Select-String -Pattern "// TODO" -Path app.js',
    'findstr "//" app.js', 'Get-Content app.js | Select-String "//"']) {
    assert.deepEqual(C.classifyDetail(cmd, WIN), { level: 1, motivo: '' }, cmd);
  }
  for (const cmd of ['cd \\\\evil\\x', 'Test-Path //evil/x', 'grep a //evil/x', 'echo \\\\evil\\x | ls', 'ls \\\\\\evil\\x']) {
    assert.match(C.classifyDetail(cmd, WIN).motivo, /rete/, cmd);
  }
});

test('#1072 — una lettera d\'unità che punta a un altro computer è rete, come cartella di lavoro e come percorso', () => {
  const PUSHD = { ...WIN, cwd: 'Z:\\', reti: ['Z:'] };
  for (const cmd of ['dir', 'ls', 'dir segreto', 'type nota.txt', 'dir \\segreto', 'dir Z:\\segreto', 'cd ..; ls']) {
    const d = C.classifyDetail(cmd, PUSHD);
    assert.equal(d.level, 2, cmd);
    assert.match(d.motivo, /rete/, cmd);
  }
  assert.equal(lvl('dir Z:\\segreto', { ...WIN, reti: ['z:'] }), 2);
  for (const cmd of ['dir C:\\Windows', 'cd C:\\Users\\Mario', 'ls C:\\Users\\Mario']) assert.equal(lvl(cmd, PUSHD), 1, cmd);
  assert.equal(lvl('dir Z:\\segreto', WIN), 1, 'senza unità di rete note, Z: è un disco come un altro');
});

test('#1072 — le unità di rete si riconoscono da dove Windows le risolve', () => {
  const { unitaDiRete } = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'shell.js'));
  const risolte = { 'y:\\': '\\\\nas\\condivisa\\', 'x:\\': 'X:\\', 'w:\\': '\\\\?\\UNC\\nas\\altra\\' };
  const realpath = (p) => { if (!(p in risolte)) throw new Error('ENOENT'); return risolte[p]; };
  assert.deepEqual(unitaDiRete('Y:\\lavoro', { win: true, realpath }), ['y:']);
  assert.deepEqual(unitaDiRete('X:\\dati', { win: true, realpath }), ['y:']);
  assert.deepEqual(unitaDiRete('W:\\', { win: true, realpath }).sort(), ['w:', 'y:']);
  assert.deepEqual(unitaDiRete('V:\\', { win: true, realpath }).sort(), ['w:', 'y:'], 'un\'unità che non risponde non diventa locale per sempre');
  risolte['v:\\'] = '\\\\nas\\v\\';
  assert.deepEqual(unitaDiRete('V:\\', { win: true, realpath }).sort(), ['v:', 'w:', 'y:']);
  assert.deepEqual(unitaDiRete('/home/mario', { win: false, realpath }), []);
});

test('#1072 — `FileSystem::` davanti a un percorso non cambia dove porta: in rete chiede, sul disco no', () => {
  for (const cmd of ['cd FileSystem::\\\\evil\\x', 'chdir filesystem::\\\\evil\\x', 'cd Microsoft.PowerShell.Core\\FileSystem::\\\\evil\\x',
    'ls FileSystem::\\\\evil\\x', 'type FileSystem::\\\\evil\\x']) {
    const d = C.classifyDetail(cmd, WIN);
    assert.equal(d.level, 2, cmd);
    assert.match(d.motivo, /rete/, cmd);
  }
  assert.equal(lvl('cd FileSystem::C:\\Windows', WIN), 1);
  assert.match(C.classifyDetail('type FileSystem::C:\\Users\\Mario\\.ssh\\id_rsa', WIN).motivo, /nascosto/);
  assert.equal(lvl('ls', { ...WIN, cwd: 'Microsoft.PowerShell.Core\\FileSystem::C:\\Users\\Mario' }), 1);
});

test('#1072 — il testo cercato non si apre: due barre nel modello non sono rete, nel file sì', () => {
  for (const cmd of ['grep -n "//TODO" app.js', 'findstr "//TODO" app.js', 'Select-String -Pattern "//TODO" -Path app.js',
    'Select-String "//eslint-disable" app.js', 'git log -S "//TODO"', 'git log --grep=//fix']) {
    assert.deepEqual(C.classifyDetail(cmd, WIN), { level: 1, motivo: '' }, cmd);
  }
  // La ricerca in una cartella intera chiedeva già prima, per i file nascosti: il motivo resta quello.
  for (const cmd of ['grep -rn "//eslint-disable" src', 'git grep "//TODO"']) {
    assert.doesNotMatch(C.classifyDetail(cmd, WIN).motivo, /rete/, cmd);
  }
  for (const cmd of ['grep TODO //evil/x/app.js', 'grep -f //evil/x/p a.txt', 'grep "//TODO" //evil/x/a.js', 'findstr /d:\\\\evil\\x a *.txt',
    'Select-String "//x" \\\\evil\\a', 'git grep x //evil/x', 'git --git-dir=\\\\evil\\x\\.git log', 'echo \\\\evil\\x | ls']) {
    assert.match(C.classifyDetail(cmd, WIN).motivo, /rete/, cmd);
  }
});

test('#1072 — stampare un testo con due barre non apre niente; usato da un altro comando (tubo, gruppo) sì', () => {
  for (const cmd of ['echo "//commento"', 'echo //evil', 'Write-Output "\\\\server\\cartella"', 'Write-Host "//commento"',
    "Out-String -InputObject '\\\\evil\\x'", 'echo //x; ls']) {
    assert.deepEqual(C.classifyDetail(cmd, WIN), { level: 1, motivo: '' }, cmd);
  }
  assert.equal(lvl('echo //evil/x', LINUX), 1);
  for (const cmd of ['echo \\\\evil\\x | cd', 'Write-Output \\\\evil\\x | Get-ChildItem', 'echo \\\\evil\\x | Test-Path',
    'cd (echo \\\\evil\\x)', 'cd $(echo \\\\evil\\x)', "Test-Path (Write-Output '\\\\evil\\x')", "Out-String -InputObject '\\\\evil\\x' | cd"]) {
    assert.match(C.classifyDetail(cmd, WIN).motivo, /rete/, cmd);
  }
});

// #1072.4 — un percorso di rete che nessun pezzo del comando scrive per intero,
// ma che un comando "innocuo" CALCOLA e poi apre (o passa a chi lo apre), chiede
// un OK: la cura guarda il risultato di Join-Path/Split-Path/Get-Date, non i pezzi.
test('#1072.4 — un percorso di rete calcolato da un comando innocuo chiede un OK', () => {
  const rete = /altro computer della rete/;
  for (const cmd of [
    "Join-Path '\\\\' 'evil\\x' -Resolve", "Join-Path -Path '\\\\' -ChildPath 'evil\\x' -Resolve",
    "Join-Path '\\\\' 'evil\\x' | cd", "Join-Path -Path '\\\\' -ChildPath evil -AdditionalChildPath x | cd",
    'Split-Path -NoQualifier C:\\\\evil\\x | cd', "Split-Path -NoQualifier 'C:\\\\evil\\x' | Test-Path",
    'Split-Path C:\\\\evil\\x -NoQualifier | Test-Path', 'Split-Path -NoQualifier C:/\\evil/x | cd',
    'Get-Date -Format "\'\'\\\\\\\\evil\\\\x" | Get-ChildItem', 'cd (Split-Path -NoQualifier C:\\\\evil\\x)',
  ]) {
    const d = C.classifyDetail(cmd, WIN);
    assert.equal(d.level, 2, `"${cmd}" compone un percorso di rete: chiede un OK (è ${d.level})`);
    assert.match(d.motivo, rete, cmd);
  }
  // Lo stesso comando su un percorso locale, o che solo STAMPA il testo, resta libero.
  for (const cmd of [
    'Join-Path C:\\Users\\Mario x', 'Split-Path -Leaf C:\\Users\\Mario\\x.txt', 'Join-Path C:\\Users\\Mario p | cd',
    "Join-Path '\\\\' 'evil\\x'", 'Get-Date -Format yyyy-MM-dd', 'Test-Path (Join-Path $env:USERPROFILE "Downloads")',
  ]) {
    assert.equal(lvl(cmd, WIN), 1, cmd);
  }
});

// #1072.4 giro 1 — il calcolo sfugge se i pezzi arrivano dal tubo, il parametro è abbreviato o la qualifica non è
// una lettera d'unità (`Env:`, `HKCU:`, `Provider::`): ognuna di queste forme compone `\\evil\x` e chiede un OK.
test('#1072.4 — un percorso di rete composto dal tubo, con parametri abbreviati o altre qualifiche chiede un OK', () => {
  for (const cmd of [
    "Write-Output '\\\\' | Join-Path -ChildPath evil\\x | cd", "Get-Date -Format '\\\\\\\\' | Join-Path -ChildPath evil\\x | cd",
    "Split-Path -NoQualifier 'C:\\\\' | Join-Path -ChildPath evil\\x | cd", "Write-Output '\\\\' | Join-Path -ChildPath evil\\x -Resolve",
    "Write-Output 'C:\\\\evil\\x' | Split-Path -NoQualifier | cd", 'echo C:\\\\evil\\x | Split-Path -NoQualifier | Test-Path',
    'Split-Path -N C:\\\\evil\\x | cd', 'Split-Path -No C:\\\\evil\\x | cd', "Join-Path '\\\\' 'evil\\x' -Resolve:$true",
    'Split-Path -NoQualifier Env:\\\\evil\\x | cd', 'Split-Path -NoQualifier HKCU:\\\\evil\\x | cd',
    "Split-Path -NoQualifier 'Foo::\\\\evil\\x' | cd", "Test-Path (Write-Output '\\\\' | Join-Path -ChildPath evil\\x)",
  ]) {
    assert.ok(lvl(cmd, WIN) >= 2, `"${cmd}" compone un percorso di rete: chiede un OK`);
  }
  for (const cmd of ["Write-Output 'C:\\x' | Join-Path -ChildPath docs | Sort-Object", 'Get-ChildItem | Split-Path -Leaf | Sort-Object',
    'Split-Path -NoQualifier HKCU:\\Software | Sort-Object', 'Split-Path -N C:\\Users\\Mario\\x | cd']) {
    assert.equal(lvl(cmd, WIN), 1, cmd);
  }
});

// #1072.4 giro 1 — in una cwd di rete il nome arriva al remoto anche come riferimento git (`.git/refs/<nome>`,
// per ogni sotto-comando) e come valore passato col tubo o da un gruppo a chi lo cerca nella cartella.
test('#1072.4 — in una cwd di rete un nome dato a git, dal tubo o da un gruppo chiede un OK', () => {
  const NOMI = ['git cat-file -t segreto', 'git reflog segreto', 'git reflog show segreto', 'git name-rev segreto',
    'git ls-tree segreto', 'git symbolic-ref segreto', 'git describe segreto', 'Write-Output segreto | Test-Path',
    'Write-Output segreto | Get-Item', 'Write-Output segreto | Resolve-Path', 'Write-Output segreto | Get-Content',
    'Write-Output segreto | Get-FileHash', 'echo segreto | cat', 'Write-Output .\\segreto | Get-Command',
    'Test-Path (Write-Output segreto)', 'Get-Content (Write-Output segreto)'];
  for (const ctx of [{ ...WIN, cwd: '\\\\host\\x' }, { ...WIN, cwd: 'Z:\\', reti: ['Z:'] }]) {
    for (const cmd of NOMI) assert.ok(lvl(cmd, ctx) >= 2, `"${cmd}" in ${ctx.cwd} manda il nome al remoto: chiede un OK`);
  }
  for (const cmd of ['git cat-file -t HEAD', 'git reflog', 'Write-Output a.txt | Test-Path', 'Test-Path (Write-Output a.txt)']) {
    assert.equal(lvl(cmd, WIN), 1, cmd);
  }
});

// #1072.4 — con la cartella di lavoro su un altro computer anche i comandi "liberi"
// che risolvono un NOME contro la cartella (Get-Command/Get-Help, where di cmd,
// git log/show/diff/rev-parse/blame) lo mandano al remoto: l'OK che vale per `ls`.
test('#1072.4 — in una cwd di rete un nome cercato nella cartella chiede un OK', () => {
  const NOMI = ['Get-Command .\\segreto', 'Get-Command -Name .\\segreto', 'Get-Help .\\segreto.ps1', 'where segreto',
    'git rev-parse segreto', 'git show segreto', 'git log segreto', 'git diff segreto', 'git blame segreto', 'git log -- segreto'];
  for (const ctx of [{ ...WIN, cwd: '\\\\host\\x' }, { ...WIN, cwd: 'Z:\\', reti: ['Z:'] }]) {
    assert.equal(C.classifyDetail('ls segreto', ctx).level, 2, `ls in ${ctx.cwd}`);
    for (const cmd of NOMI) {
      const d = C.classifyDetail(cmd, ctx);
      assert.equal(d.level, 2, `"${cmd}" in ${ctx.cwd} manda il nome al remoto: chiede un OK (è ${d.level})`);
      assert.match(d.motivo, /altro computer della rete/, `${cmd} in ${ctx.cwd}`);
    }
  }
  // Gli stessi comandi in una cartella del disco restano liberi.
  for (const cmd of ['Get-Command .\\segreto', 'Get-Help .\\segreto.ps1', 'where segreto', 'where node',
    'git rev-parse segreto', 'git show segreto', 'git log segreto', 'git diff segreto', 'git blame segreto', 'git log']) {
    assert.equal(lvl(cmd, WIN), 1, cmd);
  }
});

test('#1072 — su Windows si legge il comando come lo spezza PowerShell: virgolette tipografiche, trattini lunghi, `\\` in coda', () => {
  for (const cmd of ['cd “\\\\evil\\x”', 'cd ‘\\\\evil\\x’', 'Test-Path „\\\\evil\\x”', 'Get-ChildItem ‛\\\\evil\\x‛', 'cd -Path:“\\\\evil\\x”',
    'Set-Location —Path:\\\\evil\\x', 'Get-ChildItem –LiteralPath:\\\\evil\\x', 'findstr a src\\ \\\\evil\\x\\a', 'dir C:\\ \\\\evil\\x',
    'type src\\ \\\\evil\\x\\a']) {
    assert.match(C.classifyDetail(cmd, WIN).motivo, /rete/, cmd);
  }
  for (const cmd of ['Get-Content “..\\..\\b\\secret.txt”', 'Get-Content —LiteralPath:..\\..\\b\\secret.txt', 'findstr a src\\ ..\\..\\b\\secret.txt']) {
    assert.equal(lvl(cmd, WIN), 2, cmd);
  }
  assert.equal(lvl('Get-Content “notes.txt”', WIN), 1);
  // In bash `\ ` protegge lo spazio: è un nome solo, nella cartella di lavoro.
  assert.equal(lvl('cat my\\ file.txt', { win: false, maiuscole: false, home: '/home/a', cwd: '/home/a/p' }), 1);
});

// #1072.1 — con cmd scelto nelle Preferenze il `^` protegge il carattere dopo e sparisce: i controlli guardano il
// comando che cmd passa al programma, non la sua grafia. Con PowerShell `^` è un carattere come un altro.
const WIN_CMD = { ...WIN, shell: 'cmd' };

test('#1072.1 — con cmd il `^` non nasconde un percorso di rete', () => {
  for (const cmd of ['dir ^\\^\\host\\x', 'dir ^\\\\host\\x', 'type ^\\^\\host\\x\\a.txt', 'cd ^\\^\\host\\x', 'pushd ^\\^\\host\\x',
    'dir ^/^/host/x', 'type ^"\\\\host\\x\\a.txt^"', 'tree ^\\^\\host\\x']) {
    const d = C.classifyDetail(cmd, WIN_CMD);
    assert.equal(d.level, 2, `"${cmd}" con cmd contatta un altro computer: chiede un OK`);
    assert.match(d.motivo, /altro computer della rete/, cmd);
  }
});

test('#1072.1 — con cmd il `^` non nasconde un file nascosto o una cartella di profilo', () => {
  for (const cmd of ['type C:\\Users\\Mario\\^.ssh\\id_rsa', 'type ^.ssh\\id_rsa', 'more ^.aws\\credentials',
    'type ^"C:\\Users\\Mario\\^.ssh\\id_rsa^"', 'type C:\\Users\\Mario\\App^Data\\Roaming\\Filo\\storage.json',
    'type ^_netrc', 'findstr password ^.git-credentials']) {
    const d = C.classifyDetail(cmd, WIN_CMD);
    assert.equal(d.level, 2, `"${cmd}" con cmd legge un file nascosto: chiede un OK`);
    assert.match(d.motivo, /nascosto/, cmd);
  }
  const a = { type: 'ESEGUI_COMANDO', comando: 'type C:\\Users\\Mario\\^.ssh\\id_rsa', _perimetro: WIN_CMD };
  assert.equal(AL.costoFor(a), 2);
  assert.match(AL.describe(a), /Perché te lo chiedo: legge un file nascosto/);
});

test('#1072.1 — con cmd il `^` non nasconde un flag pericoloso, e le forme che cmd legge diverse restano «conferma»', () => {
  for (const cmd of ['git push -^-force', 'git push origin ^-^-force', 'git checkout ^.', 'git reset -^-hard']) {
    assert.equal(lvl(cmd, WIN_CMD), 3, `"${cmd}" con cmd è il comando distruttivo`);
  }
  // Un `^` in coda prende la riga dopo; su un separatore lo fa diventare testo, che finisce a un altro programma;
  // le espansioni `%` vengono prima dei `^`, quelle `!` dopo.
  for (const cmd of ['dir ^', 'findstr x a.txt ^&^& findstr \\\\host\\y b.txt', 'type a.txt ^| findstr x \\\\host\\y',
    'type ^(a.txt^)', 'type a.txt ^> b.txt', 'type %US^ERPROFILE%\\x.txt', 'type ^^.ssh\\id_rsa!']) {
    assert.equal(lvl(cmd, WIN_CMD), 3, cmd);
  }
});

test('#1072.1 — con cmd le letture di tutti i giorni restano libere; con PowerShell `^` resta un carattere', () => {
  for (const cmd of ['dir', 'dir Documenti', 'type nota.txt', 'git log HEAD^^', 'git show HEAD^^:src/a.js', 'echo ^\\^\\host\\x',
    'dir ^"Documenti personali^"', 'type "^.ssh"', 'findstr /r "^errore" log.txt']) {
    assert.deepEqual(C.classifyDetail(cmd, WIN_CMD), { level: 1, motivo: '' }, cmd);
  }
  for (const ctx of [WIN, { ...WIN, shell: 'powershell' }]) {
    for (const cmd of ['git diff HEAD^', 'git log HEAD^..HEAD', 'type C:\\Users\\Mario\\^.ssh\\id_rsa']) {
      assert.equal(lvl(cmd, ctx), 1, `"${cmd}" con PowerShell legge un nome che contiene davvero ^`);
    }
  }
  // Le virgolette tipografiche le converte PowerShell, non cmd: per cmd sono testo e `^` dopo resta un escape.
  assert.match(C.classifyDetail('type C:\\Users\\Mario\\“x” ^.ssh\\id_rsa', WIN_CMD).motivo, /nascosto/);
});

// #1072.5 — per cmd l'apice singolo è un carattere: `' \\host\x '` sono tre argomenti, e il percorso in mezzo arriva
// al programma da solo. I programmi MSYS (cat, ls di Git) invece lo leggono come virgolette: valgono tutte le letture.
test('#1072.5 — con cmd un percorso fra apici singoli non sfugge ai controlli su rete e file nascosti', () => {
  for (const [cmd, motivo] of [
    ['findstr /v \' x C:\\Users\\Mario\\.ssh\\id_rsa \'', /nascosto/],
    ['type \' C:\\Users\\Mario\\.ssh\\id_rsa \'', /nascosto/],
    ['findstr /v \' x C:\\Users\\Mario\\.ssh\\id_rsa \' | more', /nascosto/],
    ['dir \' \\\\host\\x \'', /altro computer della rete/],
    ['findstr a \' \\\\host\\x\\a.txt \'', /altro computer della rete/],
    ['dir \' \\\\host\\x \' && dir', /altro computer della rete/],
    ['dir ^\' \\\\host\\x ^\'', /altro computer della rete/],
    // Per findstr e gli altri programmi C `\"` è una `"` dentro l'argomento, non l'inizio di un gruppo.
    ['findstr /v \\" x C:\\Users\\Mario\\.ssh\\id_rsa \\"', /nascosto/],
    ['findstr a \\" \\\\host\\x\\a.txt \\"', /altro computer della rete/],
    // Letti come virgolette, come fa un programma MSYS.
    ['type \'C:\\Users\\Mario\\.ssh\\id_rsa\'', /nascosto/],
    ['dir \'\\\\host\\x\'', /altro computer della rete/],
  ]) {
    const d = C.classifyDetail(cmd, WIN_CMD);
    assert.equal(d.level, 2, `"${cmd}" con cmd chiede un OK`);
    assert.match(d.motivo, motivo, cmd);
  }
  const a = { type: 'ESEGUI_COMANDO', comando: 'findstr /v \' x C:\\Users\\Mario\\.ssh\\id_rsa \'', _perimetro: WIN_CMD };
  assert.equal(AL.costoFor(a), 2);
  assert.match(AL.describe(a), /Perché te lo chiedo: legge un file nascosto/);
  // Per PowerShell gli apici fanno una stringa sola: lì le stesse righe sono innocue.
  for (const ctx of [WIN, { ...WIN, shell: 'powershell' }]) {
    assert.equal(lvl('findstr /v \' x C:\\Users\\Mario\\.ssh\\id_rsa \'', ctx), 1);
    assert.equal(lvl('dir \' \\\\host\\x \'', ctx), 1);
  }
  for (const cmd of ['echo l\'errore', 'findstr "l\'errore" log.txt', 'findstr \'errore\' log.txt', 'dir \'Documenti personali\'',
    'git log --oneline -- \'src/a b.js\'', 'findstr /c:"a \\"b\\"" log.txt']) {
    assert.deepEqual(C.classifyDetail(cmd, WIN_CMD), { level: 1, motivo: '' }, cmd);
  }
  // `'dir'` per cmd è un programma che si chiama così, non `dir`.
  assert.equal(lvl('\'dir\'', WIN_CMD), 3);
});

test('#1072.1 — un download scritto con `^` o con le virgolette resta testo del web, non l\'uscita di un comando', () => {
  const fonte = (comando, stdout = '<html>') => AL.fonteDi({ type: 'ESEGUI_COMANDO', comando, _output: { stdout } });
  for (const comando of ['c^url h^ttps://x.it', 'w^get x.it/a', 'c"u"rl x.it', 'Invoke-We^bRequest x.it', 'curl ht""tps://x.it']) {
    assert.equal(fonte(comando).classe, 5, comando);
    assert.equal(fonte(comando).chiave, 'web:comando', comando);
  }
  assert.equal(fonte('type nota.txt', 'ciao').chiave, 'terminale:uscita');
});

// Su Linux cmd non c'è (la shell si risolve in sh): resta la regola del main, scritta.
test('#1072.1 — il comando dell\'assistente si giudica con la shell delle Preferenze, e parte con quella stessa', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'services', 'handlers.js'), 'utf8');
  assert.match(src, /if \(type === 'ESEGUI_COMANDO'\) action\._perimetro\.shell = await shellDeiComandi\(\);/);
  const esegui = src.slice(src.indexOf("case 'ESEGUI_COMANDO': {")).slice(0, 1500);
  assert.match(esegui, /const shell = \(action\._perimetro && action\._perimetro\.shell\) \|\| await shellDeiComandi\(\);/);
  assert.match(esegui, /runCommand\(cmd, \{ shell,/);
});

// Su Windows la prova contro cmd vero: `echo` stampa il comando come cmd lo passa al programma.
test('#1072.1 — la lettura dei `^` è quella di cmd vero', { skip: process.platform !== 'win32' && 'cmd esiste solo su Windows' }, async () => {
  const T = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'terminal.js'));
  for (const x of ['dir ^\\^\\host\\x', 'type C:\\Users\\nome\\^.ssh\\id_rsa', 'a^^b', '^"a ^.b^" ^.c', '"a ^.b" ^.c', 'git push -^-force']) {
    const out = await T.runCommand(`echo ${x}`, { shell: 'cmd', timeoutMs: TETTO_ATTESA_MS });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.stdout.trim(), C.comeCmd(x), x);
  }
});
