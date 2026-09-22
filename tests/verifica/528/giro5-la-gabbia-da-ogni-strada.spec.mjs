// Giro 5 di verifica del feedback #528 — «pubblicare Filo-Linux.AppImage».
//
// COSA PROVA
//   Che la scatola di sicurezza di Chromium resti accesa da OGNI strada con cui
//   si apre Filo su Linux, non solo da una.
//
//   Filo è un browser: apre siti qualunque, e quella scatola è la barriera fra
//   quei siti e il resto del computer. Il pacchetto Linux porta ormai dentro di
//   sé un lanciatore che guarda le manopole del kernel e rinuncia alla scatola
//   SOLO dove il sistema la nega — è la regola scritta nel pacchetto stesso.
//
//   La voce di menu dentro il pacchetto però chiede `--no-sandbox` sempre,
//   senza guardare niente. Chi integra Filo fra le applicazioni (è quello che
//   propone di fare Ubuntu al primo doppio clic, ed è anche l'unico modo perché
//   il link d'invito apra Filo) da lì in poi apre un browser senza la sua
//   barriera, anche su una macchina che la concede benissimo. Due strade per
//   aprire la stessa applicazione, e sono protette in modo diverso.
//
// COME L'HO VISTO
//   Pacchetto costruito qui, estratto, avviato da un utente senza privilegi su
//   una macchina che la scatola la concede. Aperto come fa il doppio clic,
//   nessun processo di Filo riceve `--no-sandbox`. Aperto come fa la voce di
//   menu, lo ricevono il renderer, la GPU e i processi di servizio.
//
// ATTENZIONE A UNA PROVA DEL GIRO 3
//   Quella prova pretende il contrario (che la voce di menu chieda sempre
//   `--no-sandbox`): era vera prima che il lanciatore esistesse. Chi chiude
//   questo rilievo deve aggiornarla insieme, altrimenti le due prove si
//   contraddicono.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACCHETTO = path.join(RADICE, 'dist', 'Filo-Linux.AppImage');
const soloLinux = process.platform !== 'linux' ? 'il pacchetto Linux si costruisce solo su Linux' : false;

function pacchettoPronto() {
  if (fs.existsSync(PACCHETTO)) return;
  execFileSync('npm', ['run', 'build:linux'], { cwd: RADICE, stdio: 'inherit', timeout: 20 * 60_000 });
}

function estrai() {
  const dove = cartellaTemporanea('filo-528-giro5-');
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

// Le manopole del kernel che il lanciatore guarda: se il pacchetto le nomina,
// la decisione la prende guardando il sistema invece che a priori.
const GUARDA_IL_SISTEMA = /apparmor_restrict_unprivileged_userns|max_user_namespaces|unprivileged_userns_clone/;

function lanciatore(dir) {
  const appRun = fs.readFileSync(path.join(dir, 'AppRun'), 'utf8');
  const nome = (appRun.match(/^BIN="?\$APPDIR\/([^"\n]+)"?/m) || [])[1] || 'filo';
  const p = path.join(dir, nome);
  try {
    if (fs.statSync(p).size < 256 * 1024) return { appRun, script: fs.readFileSync(p, 'utf8') };
  } catch (_) { /* il programma vero non è testo: nessuno script davanti */ }
  return { appRun, script: '' };
}

test('la scatola di sicurezza la decide il sistema, da qualunque strada si apra Filo', () => {
  test.skip(Boolean(soloLinux), String(soloLinux));
  test.setTimeout(25 * 60_000);
  const dir = cartella();
  const { appRun, script } = lanciatore(dir);

  // Il termine di paragone: la strada del doppio clic guarda il sistema prima
  // di decidere. È già così, e deve restarci.
  expect(
    GUARDA_IL_SISTEMA.test(script) || GUARDA_IL_SISTEMA.test(appRun),
    'chi apre il pacchetto col doppio clic non guarda più se il sistema concede la scatola',
  ).toBe(true);

  const voce = fs.readdirSync(dir).find((f) => f.endsWith('.desktop'));
  expect(voce, 'nel pacchetto non c\'è nessuna voce di menu').toBeTruthy();
  const exec = (fs.readFileSync(path.join(dir, voce), 'utf8')
    .split(/\r?\n/).find((r) => r.startsWith('Exec=')) || '');

  expect(
    exec,
    'chi apre Filo dal menu delle applicazioni, o cliccando un link d\'invito, avvia un browser '
    + 'senza la sua scatola di sicurezza anche dove il sistema la concede: la voce di menu la spegne '
    + 'sempre, senza guardare niente, mentre il doppio clic sullo stesso pacchetto la tiene accesa. '
    + 'La decisione deve stare in un posto solo, quello che guarda il sistema.',
  ).not.toMatch(/--no-sandbox/);
});
