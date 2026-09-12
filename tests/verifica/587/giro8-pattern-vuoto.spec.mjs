// Verifica #587, giro 8 — la ricerca con il testo cercato VUOTO.
//
// IL SINTOMO. È la stessa causa dei rilievi gravi dei sette giri passati —
// quello che viene misurato non è quello che il comando aprirà davvero —
// affacciata su un'altra strada, e questa volta il bersaglio non viene
// travestito: sparisce l'ALTRO operando.
//
// Per una ricerca il primo operando è il testo cercato, non un file: in
// «cerca credentials nei miei appunti» il file che si apre è appunti.txt, e al
// giro 2 misurare anche la parola cercata faceva chiedere un OK spiegando una
// cosa falsa. Da allora la parola cercata viene scartata. Se però quella parola
// è la stringa VUOTA, il conto degli operandi si sposta di uno: a essere
// scartato è il FILE, e non resta niente da misurare.
//
//   grep Host .ssh/config   → chiede un OK
//   grep ""   .ssh/config   → non chiede niente, e stampa lo stesso file
//
// Un testo cercato vuoto non è un caso di laboratorio: per grep, findstr e
// Select-String è il modo canonico di dire «stampa tutte le righe», ed è la
// prima cosa che scrive chi sta cercando di leggere un file con lo strumento
// che ha in mano.
//
// Salta tutto insieme: il riconoscimento dei bersagli riservati (.ssh, .netrc,
// il file dove Filo tiene le chiavi API e il portafoglio) E il confine della
// cartella dell'utente (/etc/shadow, il registro di Windows).
//
// COSA PROVA QUESTO FILE. Esegue davvero, con la stessa shell che usa Filo,
// dentro una finta cartella dell'utente, e guarda se dall'output esce un
// segreto: senza quel controllo la prova non direbbe niente. Le forme Windows
// sono giudicate sul classificatore, che è tutto quello che c'è qui.
//
// COSA NON VA CHIUSO A FORZA DI CONFERME: cercare una parola nei propri file
// deve continuare a non chiedere niente, in tutte le scritture, e nemmeno
// cercare a vuoto dentro un proprio documento.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdirSync, writeFileSync, rmSync, realpathSync, readdirSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/cmdClassify.js'));
const C = globalThis.SN_CMD_CLASSIFY;
// Gli stessi ganci che installa il main (src/main/services/loader.js).
C.setRealPath((p) => {
  try { return realpathSync.native(String(p)); } catch (_) {}
  try { return realpathSync(String(p)); } catch (_) {}
  return p;
});
if (C.setListDir) C.setListDir((p) => { try { return readdirSync(String(p)); } catch (_) { return []; } });

const bash = process.platform !== 'win32';
const SEGRETO_RE = /SEGRETO_[A-Z_]+|BEGIN PRIVATE/;

function fintaCasa() {
  const casa = cartellaTemporanea('587-vuoto-');
  mkdirSync(join(casa, '.ssh'), { recursive: true });
  writeFileSync(join(casa, '.ssh', 'config'), 'Host prod\n  User mario\nSEGRETO_SSH_CONFIG\n');
  writeFileSync(join(casa, '.ssh', 'id_rsa'), '-----BEGIN PRIVATE KEY-----\nSEGRETO_CHIAVE_PRIVATA\n');
  mkdirSync(join(casa, '.config', 'Filo'), { recursive: true });
  writeFileSync(join(casa, '.config', 'Filo', 'storage.json'), '{"apiKeys":{"openrouter":"SEGRETO_CHIAVE_FILO"}}');
  writeFileSync(join(casa, '.netrc'), 'machine ftp login mario password SEGRETO_FTP\n');
  mkdirSync(join(casa, 'Documenti'), { recursive: true });
  writeFileSync(join(casa, 'Documenti', 'spesa.csv'), 'pane;1,20\nlatte;0,99\n');
  writeFileSync(join(casa, 'appunti.txt'), 'spesa: pane, latte\ncredentials del corso\n');
  return casa;
}

function esegue(cmd, cwd) {
  try {
    return execFileSync('bash', ['-c', cmd], {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
      // `~` deve sciogliersi nella finta cartella dell'utente, non in quella
      // vera di chi lancia i test.
      env: { ...process.env, HOME: cwd },
    });
  } catch (e) { return String((e.stdout || '') + (e.stderr || '')); }
}

function dove(casa, cwd) {
  return { perimetro: casa, home: casa, cwd: cwd || casa, shell: 'bash' };
}
const doveWin = { perimetro: 'C:\\Users\\mario', home: 'C:\\Users\\mario', cwd: 'C:\\Users\\mario', shell: 'powershell' };

test.describe('#587 — la ricerca col testo cercato vuoto', () => {
  // ── Porta 1: il bersaglio riservato non viene più misurato ───────────────
  test('cercare a vuoto dentro un file riservato chiede un OK', () => {
    test.skip(!bash, 'serve bash per eseguire davvero la lettura');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'grep "" .ssh/config',
        "grep '' .ssh/id_rsa",
        'grep "" .netrc',
        'grep "" .config/Filo/storage.json',
        'grep "" ".ssh/config"',
        'grep "" ~/.ssh/config',
      ]) {
        const uscita = esegue(cmd, casa);
        expect(SEGRETO_RE.test(uscita), `«${cmd}» deve davvero stampare un segreto, se no la prova non dice niente`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 2: le stesse forme con i flag, gli alias e il jolly ────────────
  test('i flag, il doppio trattino e il jolly non cambiano niente', () => {
    test.skip(!bash, 'serve bash per eseguire davvero la lettura');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'grep -i "" .ssh/config',
        'grep -n "" .config/Filo/storage.json',
        'grep -a "" .ssh/id_rsa',
        'grep -h "" .netrc',
        'grep -s "" .netrc',
        'grep -m1 "" .netrc',
        'grep -E "" .ssh/config',
        'grep -F "" .netrc',
        'grep -- "" .ssh/config',
        'grep -e "" .ssh/config',
        'grep -e "" -e "" .ssh/id_rsa',
        'grep --regexp "" .ssh/config',
        'grep --group-separator= "" .netrc',
        'grep "" .ssh/*',
        'grep "" .ss?/config',
      ]) {
        const uscita = esegue(cmd, casa);
        expect(SEGRETO_RE.test(uscita), `«${cmd}» deve davvero stampare un segreto`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 3: dentro una pipeline ─────────────────────────────────────────
  test('la stessa ricerca dentro una pipeline chiede lo stesso OK', () => {
    test.skip(!bash, 'serve bash per eseguire davvero la lettura');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'grep "" .ssh/id_rsa | head -3',
        'grep "" .config/Filo/storage.json | tail -1',
      ]) {
        const uscita = esegue(cmd, casa);
        expect(SEGRETO_RE.test(uscita), `«${cmd}» deve davvero stampare un segreto`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 4: salta anche il confine della cartella dell'utente ───────────
  test('cercare a vuoto fuori dalla cartella dell’utente chiede un OK', () => {
    test.skip(!bash, 'serve bash per eseguire davvero la lettura');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'grep "" /etc/passwd',
        'grep "" /etc/shadow',
        'grep "" ../../etc/passwd',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» legge fuori dal perimetro: deve chiedere un OK`).toBeGreaterThan(1);
      }
      // La controprova che il confine c'è: la stessa lettura con `cat`.
      expect(C.classify('cat /etc/passwd', dove(casa))).toBeGreaterThan(1);
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 5: le due ricerche di Windows ──────────────────────────────────
  test('findstr e Select-String col testo vuoto misurano comunque il file', () => {
    for (const cmd of [
      'findstr "" .ssh\\config',
      'findstr /I "" .netrc',
      'findstr "" NTUSER.DAT',
      'findstr "" C:\\Windows\\System32\\config\\SAM',
      'Select-String "" .ssh\\config',
      'sls "" .ssh\\id_rsa',
      'Select-String "" AppData\\Roaming\\Filo\\storage.json',
    ]) {
      expect(C.classify(cmd, doveWin), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── La controprova: le scritture gemelle, che già chiedono ───────────────
  test('la stessa ricerca con una parola vera chiedeva già un OK', () => {
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'grep Host .ssh/config',
        'grep . .ssh/config',
        'grep "^" .ssh/config',
        'grep "" .ssh/config .netrc',
        'cat .ssh/config',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» chiedeva un OK anche prima`).toBeGreaterThan(1);
      }
      for (const cmd of ['findstr Host .ssh\\config', 'Select-String Host .ssh\\config']) {
        expect(C.classify(cmd, doveWin), `«${cmd}» chiedeva un OK anche prima`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Quello che deve restare gratis ───────────────────────────────────────
  test('cercare nei propri file non chiede niente, nemmeno a vuoto', () => {
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'grep "" appunti.txt',
        'grep "" Documenti/spesa.csv',
        'grep pane Documenti/spesa.csv',
        'grep credentials appunti.txt',
        'grep -r pane Documenti',
        'grep "" Documenti/*.csv',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» legge i file dell’utente: non deve chiedere niente`).toBe(1);
      }
      for (const cmd of ['findstr "" appunti.txt', 'Select-String "" appunti.txt', 'Select-String pane Documenti\\spesa.csv']) {
        expect(C.classify(cmd, doveWin), `«${cmd}» legge i file dell’utente: non deve chiedere niente`).toBe(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });
});
