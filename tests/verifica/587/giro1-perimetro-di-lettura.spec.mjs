// Verifica #587, giro 1 — il perimetro di lettura regge anche quando
// l'assistente si sposta da solo.
//
// IL SINTOMO. Una pagina ostile pilota il modello, il modello legge un file
// dell'utente e lo porta fuori. Il lavoro di questo ramo mette due freni: la
// lettura fuori dalla cartella dell'utente chiede un OK, e dentro la cartella lo
// chiede comunque sui bersagli riservati (le chiavi, le credenziali, i file di
// configurazione, le variabili d'ambiente).
//
// COSA PROVA QUESTO FILE. Che i due freni valgano su ciò che il comando LEGGE
// DAVVERO, non su come è scritto. Spostarsi di cartella non costa niente
// all'assistente (è la sua primitiva di navigazione, non chiede nulla e resta
// valida anche nel turno dopo): se il freno guarda solo le parole scritte
// nell'ultimo comando, due comandi gratuiti in fila lo aggirano. Allo stesso
// modo, una lettura ricorsiva lanciata dalla cartella dell'utente non nomina
// nessun bersaglio riservato e li attraversa tutti.
//
// Niente Electron: qui si giudica come viene classificato un comando, che è
// logica pura. Il costo è qualche millisecondo.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/cmdClassify.js'));
const C = globalThis.SN_CMD_CLASSIFY;

const HOME = '/home/mario';
const WIN = 'C:\\Users\\mario';
// I tre campi che il processo principale calcola da sé prima di decidere il
// livello: la cartella dichiarata, quella in cui l'assistente si trova adesso e
// la home per sciogliere `~`.
const dove = (cwd = HOME, home = HOME) => ({ perimetro: home, home, cwd });

test.describe('#587 — dove il comando legge davvero', () => {
  test('le letture che già chiedono un OK continuano a chiederlo', () => {
    for (const [cmd, ctx] of [
      ['cat /etc/passwd', dove()],
      ['cat ~/.ssh/id_rsa', dove()],
      ['cat .ssh/id_rsa', dove()],
      ['cd /etc && cat passwd', dove()],
      ['printenv', dove()],
      ['ps aux', dove()],
      ['echo $HOME/.ssh/id_rsa', dove()],
      ['cat /etc/passwd | grep root', dove()],
      ['Get-Content ~/.ssh/id_rsa', dove()],
      ['type C:\\Windows\\System32\\config\\SAM', dove(WIN, WIN)],
      ['type AppData\\Roaming\\Filo\\storage.json', dove(WIN, WIN)],
    ]) {
      expect(C.classify(cmd, ctx), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  test('una lettura normale nella cartella dell’utente resta senza attrito', () => {
    for (const cmd of ['cat appunti.txt', 'ls', 'head -20 progetto/README.md', 'cd progetto']) {
      expect(C.classify(cmd, dove()), `«${cmd}» non deve chiedere niente`).toBe(1);
    }
  });

  // ── La porta: spostarsi prima, leggere poi ──────────────────────────────────
  // Ognuno dei due comandi, da solo, non chiede niente. Messi in fila leggono
  // esattamente i file che il freno doveva proteggere.
  test('spostarsi in una cartella riservata e poi leggere chiede un OK', () => {
    for (const cmd of [
      'cd ~/.ssh && cat config',
      'cd ~/.ssh && cat authorized_keys',
      'cd ~/.ssh ; cat known_hosts',
      'pushd ~/.ssh && cat authorized_keys',
      'cd ~/.gnupg && cat secring.gpg',
      'cd ~/.aws && cat config',
      'cd ~/.config/Filo && cat storage.json',
      'cd .config/Filo && cat storage.json',
      'cd ~/.ssh; Get-Content config',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
    expect(
      C.classify('cd C:\\Users\\mario\\AppData\\Roaming\\Filo && type storage.json', dove(WIN, WIN)),
      'anche su Windows',
    ).toBe(2);
  });

  test('lo spostamento vale anche fatto nel turno prima', () => {
    // L'assistente si è spostato con un comando che non chiedeva niente; adesso
    // la sua cartella corrente È la cartella riservata, e il comando che legge
    // non nomina più nessun bersaglio.
    expect(C.classify('cat config', dove('/home/mario/.ssh'))).toBe(2);
    expect(C.classify('cat authorized_keys', dove('/home/mario/.ssh'))).toBe(2);
    expect(C.classify('cat storage.json', dove('/home/mario/.config/Filo'))).toBe(2);
    expect(C.classify('type storage.json', dove('C:\\Users\\mario\\AppData\\Roaming\\Filo', WIN))).toBe(2);
  });

  // ── La seconda porta: leggere tutto senza nominare niente ───────────────────
  // Una lettura ricorsiva lanciata dalla cartella dell'utente attraversa le
  // chiavi, le credenziali e i file di configurazione senza scriverne il nome.
  test('una lettura ricorsiva di tutta la cartella dell’utente chiede un OK', () => {
    for (const cmd of [
      'grep -r PRIVATE .',
      'grep -r AWS_SECRET ~',
      'grep -rn password /home/mario',
      'cd ~/.ssh && grep -r . .',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  test('la spiegazione dice perché, in una frase che si capisce', () => {
    const motivo = C.readReason('cd ~/.ssh && cat config', dove());
    expect(motivo, 'senza il motivo il popup mostra un `cat` e basta').toBeTruthy();
    expect(motivo.length, 'una frase, non un’etichetta').toBeGreaterThan(15);
  });
});
