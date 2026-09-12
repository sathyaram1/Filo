// Verifica #587, giro 9 — i depositi di credenziali che l'elenco non conosce.
//
// IL SINTOMO. Dentro la cartella dell'utente la lettura resta gratis salvo che
// il bersaglio sia in un elenco di nomi riservati (`.ssh`, `.aws`, `.netrc`,
// `.config`, `AppData`…). Al giro 5 all'elenco si era aggiunta una regola
// diversa e giusta — `pip config list` non nomina nessun file eppure STAMPA
// l'indirizzo del repository con dentro utente e password, quindi chiede un OK.
// Il gemello di pip non è stato toccato: `git config --list`, `git remote -v` e
// `git config --get remote.origin.url` stampano in chiaro il token che sta
// dentro l'indirizzo del deposito, e non chiedono niente.
//
// Insieme a loro restano gratis i file di credenziali di uso comune che
// nell'elenco non ci sono: `.gitconfig` (lo stesso token del comando qui sopra),
// `.my.cnf` (la password del database in chiaro), `.s3cfg` (le chiavi dello
// spazio di archiviazione), `.msmtprc` (la password della posta),
// `.m2/settings.xml` e `.gradle/gradle.properties`.
//
// COSA PROVA QUESTO FILE. I comandi di git vengono ESEGUITI davvero, con la
// stessa shell che usa Filo, dentro una finta cartella dell'utente con un token
// nella configurazione: si guarda che dall'output esca davvero il token, se no
// la prova non direbbe niente.
//
// COSA NON VA CHIUSO A FORZA DI CONFERME: l'uso quotidiano di git — stato,
// diario, differenze, rami — e la lettura dei propri file devono continuare a
// non chiedere niente.

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
const TOKEN = 'ghp_SEGRETOTOKEN123456';

function fintaCasa() {
  const casa = cartellaTemporanea('587-depositi-');
  writeFileSync(join(casa, '.gitconfig'),
    `[url "https://${TOKEN}@github.com/"]\n\tinsteadOf = https://github.com/\n[user]\n\tname = Mario\n`);
  writeFileSync(join(casa, '.my.cnf'), '[client]\nuser=mario\npassword=SEGRETO_MYSQL\n');
  writeFileSync(join(casa, '.s3cfg'), 'access_key = AKIA000\nsecret_key = SEGRETO_S3\n');
  writeFileSync(join(casa, '.msmtprc'), 'account casa\npassword SEGRETO_POSTA\n');
  mkdirSync(join(casa, '.m2'), { recursive: true });
  writeFileSync(join(casa, '.m2', 'settings.xml'), '<server><password>SEGRETO_MAVEN</password></server>');
  mkdirSync(join(casa, '.gradle'), { recursive: true });
  writeFileSync(join(casa, '.gradle', 'gradle.properties'), 'signingPassword=SEGRETO_GRADLE\n');
  writeFileSync(join(casa, 'appunti.txt'), 'spesa: pane, latte\n');
  mkdirSync(join(casa, 'Documenti'), { recursive: true });
  writeFileSync(join(casa, 'Documenti', 'spesa.csv'), 'pane;1,20\n');
  return casa;
}

function conRepo(casa) {
  const repo = join(casa, 'progetto');
  mkdirSync(repo, { recursive: true });
  const env = { ...process.env, HOME: casa, GIT_CONFIG_GLOBAL: join(casa, '.gitconfig') };
  const git = (...args) => {
    try { execFileSync('git', args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (_) {}
  };
  git('init', '-q');
  git('remote', 'add', 'origin', `https://mario:${TOKEN}@github.com/mario/progetto.git`);
  return repo;
}

function esegue(cmd, cwd, casa) {
  try {
    return execFileSync('bash', ['-c', cmd], {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: casa, GIT_CONFIG_GLOBAL: join(casa, '.gitconfig') },
    });
  } catch (e) { return String((e.stdout || '') + (e.stderr || '')); }
}

const dove = (casa, cwd) => ({ perimetro: casa, home: casa, cwd: cwd || casa, shell: 'bash' });

test.describe('#587 — i depositi di credenziali fuori dall’elenco', () => {
  // ── Porta 1: git stampa il token senza nominare nessun file ──────────────
  test('la configurazione di git stampa il token e deve chiedere un OK', () => {
    test.skip(!bash, 'serve bash per eseguire davvero i comandi');
    const casa = fintaCasa();
    try {
      const repo = conRepo(casa);
      for (const cmd of [
        'git config --list',
        'git config -l',
        'git config --get remote.origin.url',
        'git remote -v',
        'git remote get-url origin',
      ]) {
        const uscita = esegue(cmd, repo, casa);
        expect(uscita.includes(TOKEN), `«${cmd}» deve davvero stampare il token, se no la prova non dice niente`).toBe(true);
        expect(C.classify(cmd, dove(casa, repo)), `«${cmd}» stampa un token in chiaro: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 2: lo stesso token nel file da cui git lo legge ────────────────
  test('il file di configurazione di git chiede un OK', () => {
    test.skip(!bash, 'serve bash per eseguire davvero la lettura');
    const casa = fintaCasa();
    try {
      for (const cmd of ['cat .gitconfig', 'head -5 .gitconfig', 'grep -i url .gitconfig']) {
        const uscita = esegue(cmd, casa, casa);
        expect(uscita.includes(TOKEN), `«${cmd}» deve davvero stampare il token`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre un token in chiaro: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Porta 3: gli altri depositi di uso comune ────────────────────────────
  test('password del database, dello spazio di archiviazione e della posta', () => {
    test.skip(!bash, 'serve bash per eseguire davvero la lettura');
    const casa = fintaCasa();
    try {
      for (const [cmd, segreto] of [
        ['cat .my.cnf', 'SEGRETO_MYSQL'],
        ['cat .s3cfg', 'SEGRETO_S3'],
        ['cat .msmtprc', 'SEGRETO_POSTA'],
        ['cat .m2/settings.xml', 'SEGRETO_MAVEN'],
        ['cat .gradle/gradle.properties', 'SEGRETO_GRADLE'],
      ]) {
        const uscita = esegue(cmd, casa, casa);
        expect(uscita.includes(segreto), `«${cmd}» deve davvero stampare un segreto`).toBe(true);
        expect(C.classify(cmd, dove(casa)), `«${cmd}» apre una password in chiaro: deve chiedere un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Controprova: il gemello di pip chiedeva già un OK ────────────────────
  test('la configurazione di pip chiedeva già un OK', () => {
    const casa = fintaCasa();
    try {
      for (const cmd of ['pip config list', 'pip3 config list', 'cat .config/pip/pip.conf']) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» chiedeva già un OK`).toBeGreaterThan(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  // ── Quello che NON va chiuso a forza di conferme ─────────────────────────
  test('l’uso quotidiano di git e dei propri file non chiede niente', () => {
    const casa = fintaCasa();
    try {
      for (const cmd of [
        'git status',
        'git log --oneline',
        'git diff',
        'git branch',
        'git show HEAD',
        'git blame appunti.txt',
        'cat appunti.txt',
        'head -3 Documenti/spesa.csv',
        'ls Documenti',
        'grep pane Documenti/spesa.csv',
      ]) {
        expect(C.classify(cmd, dove(casa)), `«${cmd}» non deve chiedere niente`).toBe(1);
      }
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });
});
