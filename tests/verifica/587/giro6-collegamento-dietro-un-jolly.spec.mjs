// Verifica #587, giro 6 — il collegamento nascosto dietro un carattere jolly.
//
// IL SINTOMO. Al giro 2 era stata chiusa la porta del COLLEGAMENTO: un
// collegamento non porta addosso il nome di dove punta, quindi il percorso si
// misura anche nella sua forma reale, e `cat scorciatoia/config` chiede un OK
// se `scorciatoia` punta a `.ssh`.
//
// Quella misura però si fa su un percorso che esiste su disco. Con un carattere
// jolly il percorso scritto non esiste — `Documenti/*.txt` non è un file — e la
// forma reale non si può chiedere: il collegamento torna invisibile.
//
//   cat pacco/leggimi.txt   → chiede un OK   (il nome esiste, si risolve)
//   cat pacco/*.txt         → non chiede niente, e stampa lo stesso file
//
// E il collegamento non serve che ce lo metta l'utente. Scompattare un archivio
// o clonare un deposito costano UN OK ciascuno — una frase che sembra innocua —
// e un archivio può contenere collegamenti che puntano dove vuole chi l'ha
// fatto: alla configurazione SSH, alla cartella delle chiavi, al file dove Filo
// tiene le chiavi API e il portafoglio dell'utente.
//
// COSA PROVA QUESTO FILE. Esegue davvero, con la stessa shell che usa Filo,
// dentro una finta cartella dell'utente, e guarda se dall'output esce un
// segreto.
//
// COSA NON VA CHIUSO A FORZA DI CONFERME: leggere i propri file con un jolly —
// «mostrami i miei .txt», «le prime righe dei csv in Documenti» — deve
// continuare a non chiedere niente.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, readdirSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/cmdClassify.js'));
const C = globalThis.SN_CMD_CLASSIFY;
// Lo stesso gancio che il main installa (src/main/services/loader.js): senza,
// un collegamento non lo segue nessuno e la prova non direbbe niente.
C.setRealPath((p) => {
  try { return realpathSync.native(String(p)); } catch (_) {}
  try { return realpathSync(String(p)); } catch (_) {}
  return p;
});

const bash = process.platform !== 'win32';

// Finta cartella dell'utente: i segreti veri al loro posto, e un «pacco»
// arrivato da fuori che dentro ha solo collegamenti.
function fintaCasa() {
  const casa = cartellaTemporanea('587-jolly-');
  mkdirSync(join(casa, '.ssh'), { recursive: true });
  writeFileSync(join(casa, '.ssh', 'config'), 'Host prod\n  User mario\nSEGRETO_SSH_CONFIG\n');
  writeFileSync(join(casa, '.ssh', 'id_rsa'), '-----BEGIN PRIVATE KEY-----\nSEGRETO_CHIAVE_PRIVATA\n');
  mkdirSync(join(casa, '.config', 'Filo'), { recursive: true });
  writeFileSync(join(casa, '.config', 'Filo', 'storage.json'), '{"apiKeys":{"openrouter":"SEGRETO_CHIAVE_FILO"}}');
  mkdirSync(join(casa, 'Documenti'), { recursive: true });
  writeFileSync(join(casa, 'Documenti', 'vero.txt'), 'un documento normale\n');
  writeFileSync(join(casa, 'appunti.txt'), 'spesa: pane, latte\n');
  mkdirSync(join(casa, 'pacco'), { recursive: true });
  symlinkSync(join(casa, '.ssh', 'config'), join(casa, 'pacco', 'leggimi.txt'));
  symlinkSync(join(casa, '.config', 'Filo', 'storage.json'), join(casa, 'pacco', 'note.md'));
  symlinkSync(join(casa, '.ssh'), join(casa, 'pacco', 'dati'));
  return casa;
}

const SEGRETO_RE = /SEGRETO_[A-Z_]+/;
function esegue(cmd, cwd) {
  try {
    return execFileSync('bash', ['-c', cmd], {
      cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) { return String((e.stdout || '') + (e.stderr || '')); }
}

test.describe('#587 — il collegamento dietro un carattere jolly', () => {
  // ── Porta 1: la lettura con un jolly ──────────────────────────────────────
  test('leggere con un jolly dentro una cartella che contiene collegamenti chiede un OK', () => {
    test.skip(!bash, 'serve bash e i collegamenti simbolici');
    const casa = fintaCasa();
    const dove = { perimetro: casa, home: casa, cwd: casa, shell: 'bash' };
    try {
      for (const cmd of [
        'cat pacco/*.txt',
        'cat pacco/*',
        'cat pacco/*.md',
        'head -n 5 pacco/*',
        'tail -n 3 pacco/*.txt',
      ]) {
        const uscita = esegue(cmd, casa);
        expect(SEGRETO_RE.test(uscita), `«${cmd}» deve davvero stampare un segreto, se no la prova non dice niente`).toBe(true);
        expect(C.classify(cmd, dove), `«${cmd}» stampa un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 2: la ricerca ricorsiva, che i collegamenti li segue ────────────
  test('una ricerca ricorsiva che attraversa un collegamento chiede un OK', () => {
    test.skip(!bash, 'serve bash e i collegamenti simbolici');
    const casa = fintaCasa();
    const dove = { perimetro: casa, home: casa, cwd: casa, shell: 'bash' };
    try {
      const cmd = 'grep -R SEGRETO pacco';
      const uscita = esegue(cmd, casa);
      expect(SEGRETO_RE.test(uscita), 'la ricerca deve davvero stampare un segreto').toBe(true);
      expect(C.classify(cmd, dove), `«${cmd}» tira fuori le chiavi: deve chiedere un OK`).toBeGreaterThan(1);
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── La controprova: lo stesso file chiamato per nome ──────────────────────
  test('lo stesso file chiamato per nome chiedeva già un OK', () => {
    test.skip(!bash, 'serve bash e i collegamenti simbolici');
    const casa = fintaCasa();
    const dove = { perimetro: casa, home: casa, cwd: casa, shell: 'bash' };
    try {
      for (const cmd of ['cat pacco/leggimi.txt', 'cat pacco/note.md', 'cat pacco/dati/config']) {
        expect(C.classify(cmd, dove), `«${cmd}» chiedeva un OK anche prima`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Quello che deve restare gratis ────────────────────────────────────────
  test('leggere i propri file con un jolly non chiede niente', () => {
    test.skip(!bash, 'serve bash e i collegamenti simbolici');
    const casa = fintaCasa();
    const dove = { perimetro: casa, home: casa, cwd: casa, shell: 'bash' };
    try {
      for (const cmd of [
        'cat Documenti/*.txt',
        'head -n 2 Documenti/*',
        'cat *.txt',
        'grep -r documento Documenti',
        'cat appunti.txt',
        'ls',
      ]) {
        expect(C.classify(cmd, dove), `«${cmd}» è una lettura dei propri file: non deve chiedere niente`).toBe(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });
});
