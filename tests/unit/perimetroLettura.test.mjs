// Il perimetro di lettura (#587): una lettura del terminale o un documento resta
// livello 1 solo nella cartella personale, fuori da file nascosti e profilo; il
// resto (altri percorsi, variabili d'ambiente, processi) chiede un OK.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
