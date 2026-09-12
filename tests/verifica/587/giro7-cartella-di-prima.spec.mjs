// Verifica #587, giro 7 — «torna dov'eri», scritto nel modo normale.
//
// IL SINTOMO. Al giro 5 era stata chiusa la tilde che punta a una cartella di
// prima: `~-` e `~1` non portano addosso il nome di dove puntano, quindi la
// prima lettura che le segue chiede un OK. La scrittura che un modello usa
// davvero per tornare indietro, però, non è `~-`: è `cd -`, e quella non viene
// seguita. Il freno la scarta come se fosse un'opzione, quindi crede che la
// cartella di lavoro sia rimasta quella di prima.
//
//   cd .ssh && cd ~ && cd - && cat config   → non chiede niente, stampa ~/.ssh/config
//   cat .ssh/config                          → chiede un OK
//
// Nessuno dei tre spostamenti costa niente (spostarsi non legge), e nel comando
// che legge non compare niente di riservato. Il caso peggiore è lo stesso giro
// passando da `.config/Filo`, cioè il file dove Filo tiene le chiavi API e il
// portafoglio dell'utente.
//
// COSA PROVA QUESTO FILE. Esegue davvero, con la stessa shell che usa Filo,
// dentro una finta cartella dell'utente, e guarda se dall'output esce un
// segreto.
//
// COSA NON VA CHIUSO A FORZA DI CONFERME: le letture di tutti i giorni —
// spostarsi in Documenti e leggere un file, tornare nella propria cartella e
// elencare — devono continuare a non chiedere niente.

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
C.setRealPath((p) => {
  try { return realpathSync.native(String(p)); } catch (_) {}
  try { return realpathSync(String(p)); } catch (_) {}
  return p;
});
if (C.setListDir) C.setListDir((p) => { try { return readdirSync(String(p)); } catch (_) { return []; } });

const bash = process.platform !== 'win32';
const SEGRETO_RE = /SEGRETO_[A-Z_]+/;

function fintaCasa() {
  const casa = cartellaTemporanea('587-indietro-');
  mkdirSync(join(casa, '.ssh'), { recursive: true });
  writeFileSync(join(casa, '.ssh', 'config'), 'Host prod\n  User mario\nSEGRETO_SSH_CONFIG\n');
  writeFileSync(join(casa, '.ssh', 'id_rsa'), '-----BEGIN PRIVATE KEY-----\nSEGRETO_CHIAVE_PRIVATA\n');
  mkdirSync(join(casa, '.config', 'Filo'), { recursive: true });
  writeFileSync(join(casa, '.config', 'Filo', 'storage.json'), '{"apiKeys":{"openrouter":"SEGRETO_CHIAVE_FILO"}}');
  mkdirSync(join(casa, 'Documenti'), { recursive: true });
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

const dove = (casa, cwd) => ({ perimetro: casa, home: casa, cwd: cwd || casa, shell: 'bash' });

test.describe('#587 — tornare nella cartella di prima con «cd -»', () => {
  // ── Porta 1: tutto dentro un comando solo ────────────────────────────────
  test('andare, tornare e rientrare non apre le chiavi senza un OK', () => {
    test.skip(!bash, 'serve bash: «cd -» è la cartella di prima');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cd .ssh && cd ~ && cd - > /dev/null && cat config',
        'cd .ssh && cd ~ && cd - > /dev/null && cat id_rsa',
        'cd .config/Filo && cd ~ && cd - > /dev/null && cat storage.json',
      ]) {
        const uscita = esegue(cmd, casa);
        expect(SEGRETO_RE.test(uscita), `«${cmd}» deve davvero stampare un segreto, se no la prova non dice niente`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 2: senza redirezione, come lo scriverebbe un modello ───────────
  // (`cd -` stampa la cartella: un modello lo scrive anche senza `> /dev/null`,
  // e il livello non può dipendere da quel dettaglio.)
  test('la stessa cosa scritta senza redirezione, e col punto e virgola', () => {
    test.skip(!bash, 'serve bash: «cd -» è la cartella di prima');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cd .ssh && cd ~ && cd - && cat config',
        'cd .ssh; cd ~; cd -; cat id_rsa',
        'cd .config/Filo; cd ~; cd -; cat storage.json',
      ]) {
        const uscita = esegue(cmd, casa);
        expect(SEGRETO_RE.test(uscita), `«${cmd}» deve davvero stampare un segreto`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 3: lo spostamento fatto in un turno precedente ─────────────────
  // L'assistente si sposta in `.ssh` in un turno, e nel turno dopo scrive
  // `cd ~ && cd - && cat config`: la cartella corrente che il main dichiara è
  // `.ssh`, e il comando torna lì senza dirlo.
  test('con lo spostamento fatto in un turno precedente', () => {
    test.skip(!bash, 'serve bash: «cd -» è la cartella di prima');
    const casa = fintaCasa();
    try {
      const dentro = join(casa, '.ssh');
      for (const cmd of [
        'cd ~ && cd - > /dev/null && cat config',
        'cd ~ && cd - > /dev/null && cat id_rsa',
        'cd ~ && cd - > /dev/null && ls',
      ]) {
        expect(C.classify(cmd, dove(casa, dentro)), `«${cmd}» torna nella cartella delle chiavi: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 4: elenco e ricerca, non solo la stampa di un file ─────────────
  test('elencare e cercare dopo «cd -» chiede lo stesso OK', () => {
    test.skip(!bash, 'serve bash: «cd -» è la cartella di prima');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cd .ssh && cd ~ && cd - > /dev/null && ls -la',
        'cd .ssh && cd ~ && cd - > /dev/null && grep -r BEGIN .',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» guarda la cartella delle chiavi: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── La controprova: la scrittura gemella, già fermata al giro 5 ──────────
  test('la scrittura gemella con la tilde chiedeva già un OK', () => {
    test.skip(!bash, 'serve bash: «cd -» è la cartella di prima');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cd .ssh && cd ~ && cat ~-/config',
        'cd .ssh && cd ~ && cat $OLDPWD/config',
        'cat .ssh/config',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» chiedeva un OK anche prima`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Quello che deve restare gratis ───────────────────────────────────────
  test('andare e tornare fra le proprie cartelle non chiede niente', () => {
    test.skip(!bash, 'serve bash: «cd -» è la cartella di prima');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cd Documenti && cd ~ && cd - > /dev/null && cat vero.txt',
        'cd Documenti && cd ~ && cd - > /dev/null && ls',
        'cd Documenti && cat vero.txt',
        'cat appunti.txt',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» resta fra i file dell’utente: non deve chiedere niente`).toBe(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });
});
