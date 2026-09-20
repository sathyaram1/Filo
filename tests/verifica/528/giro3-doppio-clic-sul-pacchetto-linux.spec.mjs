// Giro 3 di verifica del feedback #528 — «pubblicare Filo-Linux.AppImage».
//
// COSA PROVA
//   Il sintomo dell'utente, il primo di tutti: il tester scarica il pacchetto,
//   gli dà il permesso di partire, installa libfuse2 come dice il foglietto, ci
//   fa doppio clic — e Filo non si apre lo stesso.
//
//   Il motivo sta in come il pacchetto viene AVVIATO. Chromium, che è il motore
//   di Filo, all'avvio si isola in una "scatola" usando un permesso del kernel
//   (gli spazi dei nomi utente non privilegiati). Dove quel permesso è negato —
//   ed è il caso di serie su Ubuntu 24.04 e successive — ripiega su un aiutante
//   che dentro un pacchetto di questo tipo non può avere i diritti che gli
//   servono, e allora si ferma di colpo, prima di disegnare qualunque cosa. Il
//   messaggio esce sul terminale, quindi chi ha fatto doppio clic non vede
//   niente: nessuna finestra, nessun errore.
//
//   La voce di menu DENTRO il pacchetto quel problema non ce l'ha: dichiara
//   `--no-sandbox`, cioè chiede a Filo di partire senza quella scatola. È il
//   punto d'ingresso del doppio clic a non farlo. Due strade equivalenti per
//   aprire la stessa applicazione, e solo una funziona.
//
// COME L'HO VISTO
//   Costruito il pacchetto qui, estratto, e avviato da un utente senza
//   privilegi togliendo la strada degli spazi dei nomi
//   (`--disable-namespace-sandbox`): Filo muore all'istante con
//   «The SUID sandbox helper binary was found, but is not configured
//   correctly», codice 133. Con `--no-sandbox` parte e resta su.
//
//   Verificato anche che NON basta chiederlo dal codice di Filo: la stessa
//   riga messa nel processo principale non cambia niente, perché il crollo
//   arriva prima che il codice di Filo giri. Si può solo passare dal lanciatore
//   del pacchetto.
//
// PERCHÉ È QUI E NON FRA GLI UNIT TEST
//   È la memoria di questo giro: chi corregge la rilancia con
//   `npx playwright test tests/verifica/528`. La guardia permanente, se il
//   difetto si chiude, va accanto alle altre (tests/unit/linuxSupport.test.mjs).

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACCHETTO = path.join(RADICE, 'dist', 'Filo-Linux.AppImage');

// Il pacchetto si costruisce solo su Linux, e costruirlo costa qualche minuto:
// se c'è già si riusa, altrimenti lo si fa una volta.
const soloLinux = process.platform !== 'linux' ? 'il pacchetto Linux si costruisce solo su Linux' : false;

function pacchettoPronto() {
  if (fs.existsSync(PACCHETTO)) return;
  execFileSync('npm', ['run', 'build:linux'], { cwd: RADICE, stdio: 'inherit', timeout: 20 * 60_000 });
}

// Estrae il pacchetto in una cartella temporanea e torna il percorso della
// cartella estratta. `--appimage-extract` non ha bisogno di FUSE.
function estrai() {
  const dove = cartellaTemporanea('filo-verifica-528-');
  const copia = path.join(dove, 'Filo-Linux.AppImage');
  fs.copyFileSync(PACCHETTO, copia);
  fs.chmodSync(copia, 0o755);
  execFileSync(copia, ['--appimage-extract'], { cwd: dove, stdio: 'ignore', timeout: 10 * 60_000 });
  return path.join(dove, 'squashfs-root');
}

let estratta = null;
function cartella() {
  if (!estratta) { pacchettoPronto(); estratta = estrai(); }
  return estratta;
}

const SENZA_SCATOLA = /--no-sandbox/;

test('la voce di menu del pacchetto avvia Filo senza la scatola del sistema', () => {
  test.skip(Boolean(soloLinux), String(soloLinux));
  test.setTimeout(25 * 60_000);
  const dir = cartella();
  const voce = fs.readdirSync(dir).find((f) => f.endsWith('.desktop'));
  expect(voce, 'nel pacchetto non c\'è nessuna voce di menu').toBeTruthy();
  const testo = fs.readFileSync(path.join(dir, voce), 'utf8');
  const exec = (testo.split(/\r?\n/).find((r) => r.startsWith('Exec=')) || '');
  // Questa è la strada che funziona, ed è il termine di paragone: chi apre
  // Filo dal menu delle applicazioni parte senza la scatola e non incontra il
  // muro. Se un giorno sparisse anche di qui, non funzionerebbe più niente.
  expect(exec, 'la voce di menu non chiede più l\'avvio senza la scatola del sistema').toMatch(SENZA_SCATOLA);
});

test('anche il doppio clic sul pacchetto avvia Filo senza la scatola del sistema', () => {
  test.skip(Boolean(soloLinux), String(soloLinux));
  test.setTimeout(25 * 60_000);
  const dir = cartella();

  // Il doppio clic non passa dalla voce di menu: il sistema monta il pacchetto
  // ed esegue il suo lanciatore, AppRun, che a sua volta lancia il programma
  // vero. Se né l'uno né l'altro chiedono l'avvio senza la scatola, su Ubuntu
  // 24.04 e successive Filo si ferma prima di disegnare la finestra, in
  // silenzio.
  const appRun = fs.readFileSync(path.join(dir, 'AppRun'), 'utf8');

  // Il programma che AppRun lancia: se qualcuno ci ha messo davanti un
  // lanciatore, la richiesta può stare lì.
  const nomeBin = (appRun.match(/^BIN="?\$APPDIR\/([^"\n]+)"?/m) || [])[1] || 'filo';
  const binPath = path.join(dir, nomeBin);
  let bin = '';
  try {
    // Un lanciatore è uno script di poche righe; il programma vero è un
    // eseguibile da centinaia di MB e non si legge come testo.
    if (fs.statSync(binPath).size < 256 * 1024) bin = fs.readFileSync(binPath, 'utf8');
  } catch (_) { bin = ''; }

  expect(
    SENZA_SCATOLA.test(appRun) || SENZA_SCATOLA.test(bin),
    'chi fa doppio clic sul pacchetto avvia Filo con la scatola del sistema: dove il kernel la nega '
    + '(Ubuntu 24.04 e successive, di serie) Filo si ferma prima di aprire la finestra e non dice niente. '
    + 'La voce di menu dentro lo stesso pacchetto invece la chiede: due strade per aprire Filo, una sola funziona.',
  ).toBe(true);
});
