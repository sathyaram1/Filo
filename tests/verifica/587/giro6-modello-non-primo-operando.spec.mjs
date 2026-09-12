// Verifica #587, giro 6 — la ricerca in cui il testo cercato NON è la prima
// parola scritta.
//
// IL SINTOMO. Per una ricerca il primo operando è il testo cercato, non un
// file: in `grep credentials appunti.txt` il file che viene aperto è
// `appunti.txt`. Il freno sulla lettura lo sa, e scarta il primo operando — è
// la regola aggiunta al giro 2 per non far chiedere un OK a chi cerca la parola
// «credentials» nei propri appunti.
//
// Ma su Windows il file può arrivare da un'ALTRA parte, e allora il primo
// operando è già il testo cercato: quello scartato è il FILE.
//
//   Select-String -Path .ssh\config SEGRETO     il file arriva da -Path
//   Select-String -LiteralPath .ssh\config x    idem
//   sls -Path .aws\credentials aws_secret       stesso cmdlet, alias corto
//   findstr /C:SEGRETO .ssh\config              il testo arriva da /C:
//
// Tutte e quattro sono forme normali e documentate delle due shell di Windows,
// e tutte e quattro stampano il contenuto del file riservato. Le stesse
// identiche letture con il modello davvero al primo posto
// (`Select-String SEGRETO -Path .ssh\config`, `findstr SEGRETO .ssh\config`)
// chiedono un OK: stessa lettura, due risposte diverse.
//
// Col file che arriva da `-Path` si perde anche il PERIMETRO: la stessa ricerca
// dentro `C:\Windows\System32\config\SAM` o dentro `..\..\etc\passwd` non chiede
// niente, mentre qualunque altra lettura fuori dalla cartella dell'utente lo fa.
//
// COSA NON VA CHIUSO A FORZA DI CONFERME: cercare una parola nei propri file
// deve restare gratis, con qualunque delle due scritture.
//
// Giudicato sul classificatore, non su una macchina Windows vera: qui non ce
// n'è una. Le forme dei comandi sono quelle standard di PowerShell e findstr.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/cmdClassify.js'));
const C = globalThis.SN_CMD_CLASSIFY;

const CASA = 'C:/Users/mario';
const suWindows = { perimetro: CASA, home: CASA, cwd: CASA, shell: 'powershell' };

test.describe('#587 — il testo cercato non è sempre il primo operando', () => {
  // ── Porta 1: Select-String con il file in -Path ───────────────────────────
  test('cercare dentro un file riservato passato con -Path chiede un OK', () => {
    for (const cmd of [
      'Select-String -Path .ssh\\config SEGRETO',
      'Select-String -Path .ssh\\id_rsa PRIVATE',
      'Select-String -Path .netrc password',
      'Select-String -Path .aws\\credentials aws_secret_access_key',
      'Select-String -Path AppData\\Roaming\\Filo\\storage.json apiKey',
      'Select-String -Path .ssh\\config SEGRETO -CaseSensitive',
    ]) {
      expect(C.classify(cmd, suWindows), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Porta 2: -LiteralPath e l'alias corto `sls` ───────────────────────────
  test('le altre scritture dello stesso cmdlet chiedono lo stesso OK', () => {
    for (const cmd of [
      'Select-String -LiteralPath .ssh\\config Host',
      'sls -Path .aws\\credentials aws_secret',
      'sls -LiteralPath AppData\\Roaming\\Filo\\storage.json key',
      'sls -Path .gnupg\\secring.gpg KEY',
    ]) {
      expect(C.classify(cmd, suWindows), `«${cmd}» è la stessa lettura scritta in un altro modo`).toBeGreaterThan(1);
    }
  });

  // ── Porta 3: un carattere jolly al posto del nome ─────────────────────────
  test('un carattere jolly dietro -Path non nasconde il bersaglio', () => {
    for (const cmd of [
      'Select-String -Path .ssh\\* PRIVATE',
      'sls -Path .s?h\\config SEGRETO',
      'Select-String -Path Library\\Keychains\\* x',
    ]) {
      expect(C.classify(cmd, suWindows), `«${cmd}» può acchiappare le chiavi`).toBeGreaterThan(1);
    }
  });

  // ── Porta 4: findstr, dove il testo arriva da /C: ─────────────────────────
  test('findstr con il testo in /C: misura comunque il file', () => {
    for (const cmd of [
      'findstr /C:SEGRETO .ssh\\config',
      'findstr /I /C:key AppData\\Roaming\\Filo\\storage.json',
      'findstr /R /C:BEGIN .ssh\\id_rsa',
    ]) {
      expect(C.classify(cmd, suWindows), `«${cmd}» apre un file riservato`).toBeGreaterThan(1);
    }
  });

  // ── Porta 5: col file in -Path si perde anche il perimetro ────────────────
  test('cercare fuori dalla cartella dell’utente chiede un OK anche da -Path', () => {
    for (const cmd of [
      'Select-String -Path C:\\Windows\\System32\\config\\SAM pwd',
      'Select-String -Path ..\\..\\etc\\passwd root',
      'findstr /C:pwd C:\\Windows\\System32\\config\\SAM',
    ]) {
      expect(C.classify(cmd, suWindows), `«${cmd}» legge fuori dalla cartella dell'utente`).toBeGreaterThan(1);
    }
  });

  // ── La controprova: il modello davvero al primo posto ─────────────────────
  test('la stessa lettura col modello al primo posto chiedeva già un OK', () => {
    for (const cmd of [
      'Select-String SEGRETO -Path .ssh\\config',
      'Select-String -Path .ssh\\config -Pattern SEGRETO',
      'findstr SEGRETO .ssh\\config',
    ]) {
      expect(C.classify(cmd, suWindows), `«${cmd}» chiedeva un OK anche prima`).toBeGreaterThan(1);
    }
  });

  // ── Quello che deve restare gratis ────────────────────────────────────────
  test('cercare una parola nei propri file non chiede niente', () => {
    for (const cmd of [
      'Select-String -Path appunti.txt spesa',
      'Select-String spesa -Path appunti.txt',
      'Select-String -Path Documenti\\*.txt nota',
      'sls -Path Documenti\\spese.csv importo',
      'findstr /C:spesa appunti.txt',
      'findstr spesa appunti.txt',
    ]) {
      expect(C.classify(cmd, suWindows), `«${cmd}» è una ricerca nei propri file: non deve chiedere niente`).toBe(1);
    }
  });
});
