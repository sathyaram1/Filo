// Verifica #587, giro 7 — «torna dov'eri», scritto nel modo normale.
//
// IL SINTOMO. Al giro 5 era stata chiusa la tilde che punta a una cartella di
// prima: `~-` e `~1` non portano addosso il nome di dove puntano, quindi la
// prima lettura che le segue chiede un OK. La scrittura che si usa davvero per
// tornare indietro, però, non è `~-`: è `cd -`. Quella non viene seguita — il
// trattino viene scartato come se fosse un'opzione — e il freno resta convinto
// che la cartella di lavoro sia quella di prima.
//
//   cd .ssh && cd ~ && cd - && cat config   → non chiede niente, stampa ~/.ssh/config
//   cat .ssh/config                          → chiede un OK
//   cd .ssh && cd ~ && cat ~-/config         → chiede un OK (chiuso al giro 5)
//
// Nessuno dei tre spostamenti costa niente (spostarsi non legge), e nel comando
// che legge non compare niente di riservato. Il caso peggiore è lo stesso giro
// passando da `.config/Filo`, cioè il file dove Filo tiene le chiavi API e il
// portafoglio dell'utente.
//
// COSA PROVA QUESTO FILE. Esegue davvero, con la stessa shell che usa Filo,
// dentro una finta cartella dell'utente, e guarda se dall'output esce un
// segreto: senza quel controllo la prova non direbbe niente.
//
// COSA NON VA CHIUSO A FORZA DI CONFERME: andare e tornare fra le proprie
// cartelle e leggere un proprio file deve continuare a non chiedere niente.

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
        'cd .ssh && cd ~ && cd - && cat config',
        'cd .config/Filo && cd ~ && cd - && cat storage.json',
        'cd .ssh; cd ~; cd -; cat config',
        'cd .config/Filo; cd ~; cd -; cat storage.json',
      ]) {
        const uscita = esegue(cmd, casa);
        expect(SEGRETO_RE.test(uscita), `«${cmd}» deve davvero stampare un segreto, se no la prova non dice niente`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 2: gli altri lettori, e l'elenco della cartella delle chiavi ───
  test('gli altri modi di leggere dopo «cd -» chiedono lo stesso OK', () => {
    test.skip(!bash, 'serve bash: «cd -» è la cartella di prima');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cd .ssh && cd ~ && cd - && wc -l config',
        'cd .ssh && cd ~ && cd - && head -n 3 config',
        'cd .ssh && cd ~ && cd - && ls -la',
        'cd .ssh && cd ~ && cd - && tail -n 1 config',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» guarda la cartella delle chiavi: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 3: lo spostamento fatto in un turno precedente ─────────────────
  // L'assistente si sposta in `.ssh` in un turno (gratis), e nel turno dopo
  // scrive `cd ~ && cd - && cat config`: la cartella corrente che il main
  // dichiara è `.ssh`, e il comando ci torna senza nominarla.
  test('con lo spostamento fatto in un turno precedente', () => {
    test.skip(!bash, 'serve bash: «cd -» è la cartella di prima');
    const casa = fintaCasa();
    try {
      const dentro = join(casa, '.ssh');
      for (const cmd of [
        'cd ~ && cd - && cat config',
        'cd ~ && cd - && ls',
        'cd ~ && cd - && wc -l config',
      ]) {
        expect(C.classify(cmd, dove(casa, dentro)), `«${cmd}» torna nella cartella delle chiavi: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── La controprova: le scritture gemelle, già fermate ────────────────────
  test('le scritture gemelle chiedevano già un OK', () => {
    test.skip(!bash, 'serve bash: «cd -» è la cartella di prima');
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'cd .ssh && cd ~ && cat ~-/config',
        'cd .ssh && cd ~ && cat $OLDPWD/config',
        'cat .ssh/config',
        'cd .ssh && cat config',
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
        'cd Documenti && cd ~ && cd - && cat vero.txt',
        'cd Documenti && cd ~ && cd - && ls',
        'cd Documenti && cat vero.txt',
        'cd ~ && cat appunti.txt',
        'cat appunti.txt',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» resta fra i file dell’utente: non deve chiedere niente`).toBe(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });
});
