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
    'cat file | grep x',       // | pipe
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

test('una sequenza con pipe/background/redirezione NON è sicura → resta 3', () => {
  // Solo `&&`/`||`/`;` contano come sequenziamento sicuro: tutto il resto è 3
  // anche se i singoli pezzi sarebbero letture.
  for (const cmd of [
    'ls | cat',          // pipe
    'cat a && ls | cat', // pipe dentro una sequenza
    'ls & pwd',          // background
    'cd x && ls > out',  // redirezione
    'cd x && echo $(pwd)',
  ]) {
    assert.equal(lvl(cmd), 3, `"${cmd}" non è una sequenza sicura → livello 3`);
  }
});

test('livello 3 — flag pericolosi alzano un comando altrimenti ≤2', () => {
  assert.equal(lvl('git reset --hard'), 3);
  assert.equal(lvl('git clean -fd'), 3);
  assert.equal(lvl('git push --force'), 3);
  assert.equal(lvl('git checkout --force main'), 3);
  assert.equal(lvl('git branch -D feature'), 3); // -D = force delete
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

test('"criterio di fatto" della spec — gli esempi citati', () => {
  assert.equal(lvl('ls'), 1, 'ls esegue subito');
  assert.equal(lvl('git push'), 2, 'git push → popup');
  assert.equal(lvl('rm qualcosa'), 3, 'rm → digita conferma');
  assert.equal(lvl('comandoinventato'), 3, 'comando inventato → digita conferma');
  assert.equal(lvl('ls && rm -rf /'), 3, '&& → livello 3');
});
