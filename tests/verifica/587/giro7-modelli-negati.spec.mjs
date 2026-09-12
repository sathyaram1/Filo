// Verifica #587, giro 7 — i modelli "tutto TRANNE" e le classi di caratteri.
//
// IL SINTOMO. È la stessa causa dei giri passati — quello che viene misurato
// non è quello che il comando aprirà davvero — affacciata su un'altra strada.
// Al giro 2 era stato chiuso il carattere jolly: un modello non è un nome, e si
// misura sulla domanda opposta («può acchiappare un bersaglio riservato?»).
// Quella domanda però viene tradotta in un'espressione regolare che non legge
// due forme che la shell legge benissimo:
//
//   .[!x]sh          in bash «un carattere qualsiasi tranne x» → acchiappa .ssh
//   .s[[:lower:]]h   in bash «una lettera minuscola»           → acchiappa .ssh
//
// Le due scritture gemelle vengono già fermate (`.[^x]sh`, `.s[a-z]h`): stessa
// lettura, due risposte diverse.
//
//   cat .ssh/config      → chiede un OK
//   cat .[!x]sh/config   → non chiede niente, e stampa lo stesso file
//
// Il caso peggiore è `.[!x]onfig/Filo/storage.json`, il file dove Filo tiene le
// chiavi API e il portafoglio dell'utente.
//
// COSA PROVA QUESTO FILE. Esegue davvero, con la stessa shell che usa Filo,
// dentro una finta cartella dell'utente, e guarda se dall'output esce un
// segreto: senza quel controllo la prova non direbbe niente.
//
// COSA NON VA CHIUSO A FORZA DI CONFERME: leggere i propri file con un jolly —
// «mostrami i miei .txt», «le prime righe dei csv in Documenti» — deve
// continuare a non chiedere niente.

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
const SEGRETO_RE = /SEGRETO_[A-Z_]+/;

function fintaCasa() {
  const casa = cartellaTemporanea('587-negati-');
  mkdirSync(join(casa, '.ssh'), { recursive: true });
  writeFileSync(join(casa, '.ssh', 'config'), 'Host prod\n  User mario\nSEGRETO_SSH_CONFIG\n');
  writeFileSync(join(casa, '.ssh', 'id_rsa'), '-----BEGIN PRIVATE KEY-----\nSEGRETO_CHIAVE_PRIVATA\n');
  mkdirSync(join(casa, '.config', 'Filo'), { recursive: true });
  writeFileSync(join(casa, '.config', 'Filo', 'storage.json'), '{"apiKeys":{"openrouter":"SEGRETO_CHIAVE_FILO"}}');
  writeFileSync(join(casa, '.netrc'), 'machine ftp login mario password SEGRETO_FTP\n');
  mkdirSync(join(casa, 'Documenti'), { recursive: true });
  writeFileSync(join(casa, 'Documenti', 'spesa.csv'), 'pane;1,20\nlatte;0,99\n');
  writeFileSync(join(casa, 'Documenti', 'vero.txt'), 'un documento normale\n');
  writeFileSync(join(casa, 'appunti.txt'), 'spesa: pane, latte\n');
  return casa;
}

function esegue(cmd, cwd) {
  try {
    return execFileSync('bash', ['-c', cmd], {
      cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) { return String((e.stdout || '') + (e.stderr || '')); }
}

function dove(casa) {
  return { perimetro: casa, home: casa, cwd: casa, shell: 'bash' };
}

test.describe('#587 — i modelli che dicono «tutto tranne»', () => {
  // ── Porta 1: la negazione POSIX `[!…]` ───────────────────────────────────
  test('un modello «tutto tranne» non nasconde il bersaglio', () => {
    test.skip(!bash, 'serve bash per l’espansione dei modelli');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cat .[!x]sh/config',
        'cat .[!x]sh/id_rsa',
        'cat .s[!x]h/id_rsa',
        'cat .ss[!x]/config',
        'cat .s[!a-r]h/id_rsa',
        'cat .[!x]etrc',
        'cat .[!x]onfig/Filo/storage.json',
      ]) {
        const uscita = esegue(cmd, casa);
        expect(SEGRETO_RE.test(uscita), `«${cmd}» deve davvero stampare un segreto, se no la prova non dice niente`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 2: le classi di caratteri POSIX ────────────────────────────────
  test('una classe di caratteri non nasconde il bersaglio', () => {
    test.skip(!bash, 'serve bash per l’espansione dei modelli');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cat .s[[:lower:]]h/config',
        'cat .s[[:alpha:]]h/id_rsa',
        'cat .[[:lower:]]onfig/Filo/storage.json',
      ]) {
        const uscita = esegue(cmd, casa);
        expect(SEGRETO_RE.test(uscita), `«${cmd}» deve davvero stampare un segreto, se no la prova non dice niente`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 3: gli altri programmi che leggono, e la cartella intera ───────
  test('lo stesso modello con gli altri lettori e sulla cartella intera', () => {
    test.skip(!bash, 'serve bash per l’espansione dei modelli');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cat .[!x]sh/*',
        'head -n 3 .[!x]sh/id_rsa',
        'tail -n 2 .[!x]sh/config',
        'wc -c .[!x]sh/id_rsa',
        'grep -r BEGIN .[!x]sh',
        'grep BEGIN .[!x]sh/id_rsa',
      ]) {
        const uscita = esegue(cmd, casa);
        expect(SEGRETO_RE.test(uscita) || /BEGIN PRIVATE/.test(uscita), `«${cmd}» deve davvero tirare fuori un segreto`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
      }
      // Elencare la cartella delle chiavi non stampa i file, ma è la stessa
      // lettura che scritta `.ssh` chiede un OK.
      for (const cmd of ['ls .[!x]sh', 'ls -la .[!x]sh', 'tree .[!x]sh']) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» punta alla cartella delle chiavi: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 4: lo spostamento con un modello negato ────────────────────────
  test('spostarsi con un modello «tutto tranne» e poi leggere chiede un OK', () => {
    test.skip(!bash, 'serve bash per l’espansione dei modelli');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cd .[!x]sh && cat config',
        'cd .[!x]sh; cat id_rsa',
        'cd .[!x]onfig/Filo && cat storage.json',
        'cd .s[[:lower:]]h && cat config',
      ]) {
        const uscita = esegue(cmd, casa);
        expect(SEGRETO_RE.test(uscita), `«${cmd}» deve davvero stampare un segreto`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── La controprova: le scritture gemelle, che già chiedono ───────────────
  test('le scritture gemelle chiedevano già un OK', () => {
    test.skip(!bash, 'serve bash per l’espansione dei modelli');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cat .ssh/config',
        'cat .[^x]sh/config',
        'cat .s[a-z]h/config',
        'cat .s?h/config',
        'cat .config/Filo/storage.json',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» chiedeva un OK anche prima`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Quello che deve restare gratis ───────────────────────────────────────
  test('leggere i propri file con un modello non chiede niente', () => {
    test.skip(!bash, 'serve bash per l’espansione dei modelli');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cat Documenti/*.txt',
        'head -n 2 Documenti/*.csv',
        'cat *.txt',
        'cat appunti.txt',
        'ls Documenti',
        'grep -r pane Documenti',
        'cat Docum[!x]nti/vero.txt',
        'cat Docum[[:lower:]]nti/vero.txt',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» legge i file dell’utente: non deve chiedere niente`).toBe(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Su un Mac la cassetta dei segreti si chiama Libreria ─────────────────
  test('la cartella Libreria di un Mac non si nasconde dietro un modello negato', () => {
    test.skip(!bash, 'serve bash per l’espansione dei modelli');
    const casa = cartellaTemporanea('587-negati-mac-');
    try {
      mkdirSync(join(casa, 'Library', 'Application Support', 'Filo'), { recursive: true });
      writeFileSync(join(casa, 'Library', 'Application Support', 'Filo', 'storage.json'), '{"apiKeys":{"openrouter":"SEGRETO_CHIAVE_FILO"}}');
      for (const cmd of [
        'cat Li[!x]rary/Application\\ Support/Filo/storage.json',
        'cat Li[[:lower:]]rary/Application\\ Support/Filo/storage.json',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre il file delle chiavi di Filo: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });
});
