// Verifica #587, giro 9 — un punto in fondo al nome della cartella, su Windows.
//
// IL SINTOMO. È la stessa causa dei rilievi gravi dei giri passati — quello che
// viene misurato non è quello che il comando aprirà davvero — su una strada che
// nessun giro aveva ancora battuto: non un carattere jolly, non una barra
// rovesciata, non una sequenza di escape, ma un PUNTO in fondo al nome.
//
// Windows, quando apre un percorso, toglie i punti e gli spazi finali da ogni
// pezzo del percorso: `.ssh.\config` è `.ssh\config`, `AppData.\Roaming` è
// `AppData\Roaming`. Il controllo invece confronta il nome scritto con l'elenco
// dei nomi riservati carattere per carattere, e `.ssh.` non è `.ssh`.
//
//   Get-Content .ssh\config    → chiede un OK
//   Get-Content .ssh.\config   → non chiede niente, e apre lo stesso file
//
// Windows è la piattaforma su cui Filo si scrive e si prova, quindi non è un
// caso di laboratorio: è la strada principale.
//
// COSA PROVA QUESTO FILE. Il classificatore, che è tutto quello che si può
// giudicare senza una macchina Windows sotto mano (la stessa scelta dei giri
// 3, 6 e 8 per le forme Windows). Le forme con lo spazio finale — l'altro
// carattere che Windows toglie — vengono già fermate e restano qui come
// controprova.
//
// COSA NON VA CHIUSO A FORZA DI CONFERME: leggere i propri file deve continuare
// a non chiedere niente, compresi i nomi con dei punti IN MEZZO
// (`nota.v2.txt`, `relazione.finale.txt`), che sono normalissimi.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/cmdClassify.js'));
const C = globalThis.SN_CMD_CLASSIFY;

const CASA_WIN = 'C:\\Users\\mario';
const win = { perimetro: CASA_WIN, home: CASA_WIN, cwd: CASA_WIN, shell: 'powershell' };

test.describe('#587 — il punto in fondo al nome, su Windows', () => {
  // ── Porta 1: la lettura diretta ──────────────────────────────────────────
  test('la cartella delle chiavi scritta con un punto in fondo chiede un OK', () => {
    for (const cmd of [
      'Get-Content .ssh.\\config',
      'Get-Content .ssh.\\id_rsa',
      'gc .ssh.\\config',
      'type .ssh.\\config',
      'Get-Content .ssh..\\config',
      'Get-Content .ssh...\\config',
      'Get-Content .\\.ssh.\\config',
      'Get-Content C:\\Users\\mario\\.ssh.\\config',
      'Get-Content ~/.ssh./config',
      'Get-ChildItem .ssh.',
      'Get-Content .ssh.\\config | Select-Object -First 5',
    ]) {
      expect(C.classify(cmd, win), `«${cmd}» apre ~/.ssh: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Porta 2: il caso peggiore, il file delle chiavi di Filo ─────────────
  test('il file dove Filo tiene chiavi e portafoglio chiede un OK anche col punto', () => {
    for (const cmd of [
      'Get-Content AppData.\\Roaming\\Filo\\storage.json',
      'Get-Content AppData\\Roaming.\\Filo\\storage.json',
      'type AppData.\\Roaming\\Filo\\storage.json',
      'Get-Content .config.\\Filo\\storage.json',
    ]) {
      expect(C.classify(cmd, win), `«${cmd}» apre il file delle chiavi di Filo: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Porta 3: gli altri bersagli riservati ────────────────────────────────
  test('le altre casseforti scritte col punto chiedono un OK', () => {
    for (const cmd of [
      'Get-Content .netrc.',
      'type .netrc.',
      'Get-Content .gnupg.\\secring.gpg',
      'Get-Content .aws.\\credentials',
      'Get-Content NTUSER.DAT.',
    ]) {
      expect(C.classify(cmd, win), `«${cmd}» apre un bersaglio riservato: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Porta 4: le ricerche dentro i file ───────────────────────────────────
  test('cercare dentro quei file col punto chiede lo stesso OK', () => {
    for (const cmd of [
      'Select-String -Path .ssh.\\config Host',
      'sls -Path .ssh.\\config Host',
      'findstr /C:Host .ssh.\\config',
      'Select-String -Path AppData.\\Roaming\\Filo\\storage.json key',
    ]) {
      expect(C.classify(cmd, win), `«${cmd}» legge un bersaglio riservato: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Porta 5: lo spostamento ──────────────────────────────────────────────
  test('spostarsi nella cartella scritta col punto e poi leggere chiede un OK', () => {
    for (const cmd of [
      'cd .ssh. ; type config',
      'Set-Location .ssh. ; Get-Content config',
      'cd AppData.\\Roaming\\Filo ; Get-Content storage.json',
      'pushd .ssh. ; Get-Content config',
    ]) {
      expect(C.classify(cmd, win), `«${cmd}» finisce per aprire un bersaglio riservato: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Porta 6: l'altra strada, senza terminale ─────────────────────────────
  test('«leggi questo file» col punto in fondo chiede lo stesso OK del terminale', () => {
    for (const p of [
      'C:\\Users\\mario\\.ssh.\\config',
      'C:\\Users\\mario\\AppData.\\Roaming\\Filo\\storage.json',
      'C:\\Users\\mario\\.netrc.',
    ]) {
      const perche = C.pathReason(p, { perimetro: CASA_WIN, home: CASA_WIN, soloRiservati: true });
      expect(perche, `«${p}» è un bersaglio riservato: LEGGI_DOCUMENTO deve chiedere un OK`).toBeTruthy();
    }
  });

  // ── Controprova: la scrittura gemella era già fermata ────────────────────
  test('senza il punto la stessa lettura chiedeva già un OK', () => {
    for (const cmd of [
      'Get-Content .ssh\\config',
      'Get-Content AppData\\Roaming\\Filo\\storage.json',
      'Get-Content .netrc',
      'Get-Content ".ssh \\config"',
    ]) {
      expect(C.classify(cmd, win), `«${cmd}» chiedeva già un OK`).toBeGreaterThan(1);
    }
  });

  // ── Quello che NON va chiuso a forza di conferme ─────────────────────────
  test('leggere i propri file non chiede niente, punti in mezzo compresi', () => {
    for (const cmd of [
      'Get-Content appunti.txt',
      'Get-Content Documenti\\nota.v2.txt',
      'Get-Content Documenti\\relazione.finale.txt',
      'Get-ChildItem Documenti',
      'Select-String -Path Documenti\\spesa.csv pane',
      'Get-Content Documenti\\*.csv',
      'type appunti.txt',
    ]) {
      expect(C.classify(cmd, win), `«${cmd}» legge roba dell'utente: non deve chiedere niente`).toBe(1);
    }
  });
});
