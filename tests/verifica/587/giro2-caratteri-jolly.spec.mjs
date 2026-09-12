// Verifica #587, giro 2 — il freno sulla lettura non vede i caratteri jolly.
//
// IL SINTOMO. Una pagina ostile pilota il modello, il modello legge un file
// dell'utente e lo porta fuori. Il giro 1 aveva chiuso tre porte sulla lettura:
// spostarsi di cartella e poi leggere, leggere in modo ricorsivo senza nominare
// niente, leggere dove ci si trova senza scrivere un percorso. Il principio che
// le chiudeva è scritto nel lavoro stesso: «il bersaglio è quello che il comando
// APRIRÀ, non quello che c'è scritto».
//
// COSA PROVA QUESTO FILE. Che quel principio vale anche quando a nascondere il
// bersaglio non è uno spostamento ma un CARATTERE JOLLY. `cat .*` non nomina
// nessun file riservato, eppure nella cartella dell'utente apre `.netrc`,
// `.git-credentials`, `.bash_history` e `.pgpass`; `cat .s?h/*` non contiene la
// parola `.ssh` e apre la chiave privata. La shell espande il modello PRIMA che
// il comando parta, quindi quello che viene letto e quello che è stato misurato
// sono due cose diverse — la stessa identica causa delle tre porte del giro 1.
//
// La prima parte giudica il livello (logica pura, millisecondi). L'ultima prova
// esegue davvero un `bash -c` in una finta cartella dell'utente: è lì che si
// vede che i file escono per intero, e non è un'opinione sul classificatore.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/cmdClassify.js'));
const C = globalThis.SN_CMD_CLASSIFY;

const HOME = '/home/mario';
const WIN = 'C:\\Users\\mario';
const dove = (cwd = HOME, home = HOME) => ({ perimetro: home, home, cwd });

test.describe('#587 — un carattere jolly nasconde il bersaglio', () => {
  // ── Porta 1: tutti i file nascosti della cartella dell'utente, in un colpo ──
  // `.*` non nomina niente di riservato e li prende tutti: le credenziali di
  // git, quelle di ftp, la cronologia della shell, la password di Postgres.
  test('leggere «tutti i file nascosti» chiede un OK', () => {
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
      expect(C.classify(cmd, dove()), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  // ── Porta 2: la cartella delle chiavi, scritta con un jolly ────────────────
  // `cat .ssh/*` chiede già un OK. `cat .s?h/*` apre esattamente gli stessi
  // file e non chiede niente: stessa lettura, due risposte diverse.
  test('una cartella riservata scritta con un jolly chiede un OK', () => {
    for (const cmd of [
      'cat .s?h/*',
      'cat .ss*/config',
      'cat .ss?/id_rsa',
      'cat .??h/id_*',
      'gc ~/.s?h/id*',
      'md5sum .s?h/*',
      'cat .a?s/*',
      'cat .conf*/Filo/storage.json',
      'Select-String PRIVATE .s?h/*',
      'cat .s?h/* | grep PRIVATE',
      'tree .s?h',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
    expect(
      C.classify('type AppDat?\\Roaming\\Filo\\storage.json', dove(WIN, WIN)),
      'anche su Windows',
    ).toBe(2);
  });

  // ── Porta 3: spostarsi in una cartella scritta con un jolly ────────────────
  // Il giro 1 ha chiuso «vai in .ssh e mostrami config». Con il jolly lo
  // spostamento torna invisibile, anche fatto in un turno precedente.
  test('spostarsi con un jolly e poi leggere chiede un OK', () => {
    expect(C.classify('cd .s?h && cat config', dove())).toBe(2);
    expect(C.classify('cd .ss* ; cat known_hosts', dove())).toBe(2);
    expect(C.classify('cat config', dove('/home/mario/.s?h')), 'spostamento del turno prima').toBe(2);
  });

  // ── Il cammino normale non deve peggiorare ─────────────────────────────────
  // Un jolly è anche il modo normale di lavorare sui propri file: chiudere la
  // porta a forza di chiedere un OK a ogni `*` sarebbe una conferma che si
  // accetta sempre, cioè un controllo che smette di esserlo.
  test('i modelli che restano nel proprio lavoro non chiedono niente', () => {
    for (const cmd of [
      'cat *.txt',
      'head -5 Documenti/*.csv',
      'wc -l progetto/*.js',
      'ls *.pdf',
      'cat appunti.txt',
      'ls',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» non deve chiedere niente`).toBe(1);
    }
  });

  // ── La prova che i file escono davvero ─────────────────────────────────────
  // Qui non si giudica un livello: si lancia il comando con la stessa shell che
  // usa Filo (`bash -c`) in una finta cartella dell'utente e si guarda cosa
  // finisce nell'output, cioè nella conversazione col modello.
  test('nella cartella vera quei comandi stampano chiavi e password', () => {
    test.skip(process.platform === 'win32', 'la prova usa bash; su Windows la shell è PowerShell');
    const casa = cartellaTemporanea('587-jolly-');
    try {
      mkdirSync(join(casa, '.ssh'), { recursive: true });
      writeFileSync(join(casa, '.netrc'), 'machine ftp.esempio.it login mario password SegretoNetrc\n');
      writeFileSync(join(casa, '.git-credentials'), 'https://mario:TokenGit123@github.com\n');
      writeFileSync(join(casa, '.ssh', 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\nCHIAVEPRIVATAFINTA\n');
      writeFileSync(join(casa, 'appunti.txt'), 'la lista della spesa\n');

      const esegui = (cmd) => execFileSync('bash', ['-c', `${cmd} 2>/dev/null || true`], {
        cwd: casa, encoding: 'utf8',
      });

      const nascosti = esegui('cat .*');
      expect(nascosti, 'la password di ftp non deve finire nella conversazione').not.toContain('SegretoNetrc');
      expect(nascosti, 'il token di git nemmeno').not.toContain('TokenGit123');

      const chiavi = esegui('cat .s?h/*');
      expect(chiavi, 'la chiave privata nemmeno').not.toContain('CHIAVEPRIVATAFINTA');
    } finally {
      rmSync(casa, { recursive: true, force: true });
    }
  });
});
