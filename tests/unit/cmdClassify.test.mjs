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

test('"criterio di fatto" della spec — gli esempi citati', () => {
  assert.equal(lvl('ls'), 1, 'ls esegue subito');
  assert.equal(lvl('git push'), 2, 'git push → popup');
  assert.equal(lvl('rm qualcosa'), 3, 'rm → digita conferma');
  assert.equal(lvl('comandoinventato'), 3, 'comando inventato → digita conferma');
  assert.equal(lvl('ls && rm -rf /'), 3, '&& → livello 3');
});
