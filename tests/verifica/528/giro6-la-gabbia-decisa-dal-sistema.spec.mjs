// Giro 6 di verifica del feedback #528 — «pubblicare Filo-Linux.AppImage».
//
// COSA PROVA
//   Il lanciatore dentro il pacchetto Linux decide da solo se Filo deve partire
//   senza la gabbia di sicurezza di Chromium, leggendo tre manopole del kernel.
//   Le prove che c'erano leggono le manopole di QUESTA macchina e si aspettano
//   la stessa risposta: su un contenitore che la gabbia la concede — cioè
//   ovunque giri la verifica — il ramo «il sistema la nega» non viene mai
//   percorso. È proprio il ramo che riguarda il tester (Ubuntu 24.04 la nega di
//   serie), ed è quello senza il quale Filo non si apre affatto.
//
//   Qui le tre manopole vengono finte, una alla volta, e il lanciatore viene
//   ESEGUITO su ciascuna: dove la risposta è «negata» deve aggiungere
//   `--no-sandbox`, dove è «concessa» non deve, e in nessun caso deve perdere
//   per strada il link d'invito.
//
// COME FUNZIONA
//   Il lanciatore lo scrive lo stesso passo che gira nella costruzione del
//   pacchetto. Per fingere le manopole si riscrivono i soli percorsi /proc, che
//   in un test non si possono cambiare davvero.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require_ = createRequire(import.meta.url);
const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(RADICE, 'package.json'), 'utf8'));

const soloPosix = process.platform === 'win32'
  ? 'il lanciatore è del pacchetto Linux: qui non c\'è una shell che lo esegua'
  : false;

const MANOPOLE = {
  apparmor: '/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
  massimo: '/proc/sys/user/max_user_namespaces',
  vecchia: '/proc/sys/kernel/unprivileged_userns_clone',
};

// Il lanciatore vero, attorno a un finto programma che stampa cosa gli arriva.
// `manopole` sostituisce i percorsi /proc con file scritti qui: è l'unico modo
// di far vedere al lanciatore un kernel diverso da quello della macchina.
async function lanciatore(manopole) {
  const hook = pkg.build?.afterPack;
  expect(hook, 'build.afterPack sparito: nel pacchetto Linux non entra più nessun lanciatore').toBeTruthy();
  const { default: afterPack } = require_(path.join(RADICE, hook));
  const dove = cartellaTemporanea('filo-528-giro6-');
  fs.writeFileSync(path.join(dove, 'filo'), '#!/bin/sh\nfor a in "$@"; do echo "[$a]"; done\n', { mode: 0o755 });
  await afterPack({
    electronPlatformName: 'linux',
    appOutDir: dove,
    packager: { executableName: 'filo', appInfo: { productFilename: 'Filo' } },
  });
  fs.chmodSync(path.join(dove, 'filo'), 0o755);

  const script = path.join(dove, 'filo');
  let testo = fs.readFileSync(script, 'utf8');
  for (const [nome, vero] of Object.entries(MANOPOLE)) {
    const finta = path.join(dove, `manopola-${nome}`);
    if (manopole[nome] !== undefined) fs.writeFileSync(finta, `${manopole[nome]}\n`);
    expect(testo, `il lanciatore non guarda più ${vero}`).toContain(vero);
    testo = testo.split(vero).join(finta);
  }
  fs.writeFileSync(script, testo, { mode: 0o755 });
  fs.chmodSync(script, 0o755);
  return script;
}

const ricevuti = (uscita) => String(uscita).split('\n')
  .filter((r) => r.startsWith('[') && r.endsWith(']'))
  .map((r) => r.slice(1, -1));

const INVITO = 'filo://invito/ABC-123';

// Le tre manopole, coi valori che su una macchina vera vogliono dire «negata».
// Ognuna da sola deve bastare: su Ubuntu 24.04 parla la prima, su Debian e Arch
// la terza, e nessuna delle due esiste dove parla l'altra.
const NEGANO = [
  ['la restrizione di Ubuntu 23.10 e successive', { apparmor: '1' }],
  ['il tetto degli spazi dei nomi a zero', { massimo: '0' }],
  ['la forma vecchia di Debian e Arch', { vecchia: '0' }],
];

for (const [come, manopole] of NEGANO) {
  test(`dove il kernel nega la gabbia (${come}) Filo parte lo stesso, col doppio clic`, async () => {
    test.skip(Boolean(soloPosix), String(soloPosix));
    const filo = await lanciatore(manopole);
    const arrivati = ricevuti(execFileSync(filo, [INVITO], { encoding: 'utf8' }));
    expect(
      arrivati,
      'qui il kernel nega gli spazi dei nomi utente: senza rinunciare alla gabbia Chromium '
      + 'non parte affatto, e chi ha fatto doppio clic non vede niente',
    ).toContain('--no-sandbox');
    expect(arrivati, 'il link d\'invito si perde per strada').toContain(INVITO);
  });
}

test('dove il kernel concede la gabbia, Filo resta protetto da ogni strada', async () => {
  test.skip(Boolean(soloPosix), String(soloPosix));
  const filo = await lanciatore({ apparmor: '0', massimo: '31428', vecchia: '1' });

  const doppioClic = ricevuti(execFileSync(filo, [INVITO], { encoding: 'utf8' }));
  expect(
    doppioClic,
    'su una macchina che la gabbia la concede Filo ci rinuncia lo stesso: è un browser, '
    + 'e quella gabbia è la barriera fra i siti che apre e il resto del computer',
  ).not.toContain('--no-sandbox');

  // La voce di menu del pacchetto chiede sempre `--no-sandbox`, senza guardare
  // niente: è quella che il sistema installa quando l'utente integra Filo fra
  // le applicazioni, ed è anche l'unica strada per cui il link d'invito lo apra.
  const daMenu = ricevuti(execFileSync(filo, ['--no-sandbox', INVITO], { encoding: 'utf8' }));
  expect(
    daMenu,
    'chi ha integrato Filo fra le applicazioni naviga senza la barriera anche dove il sistema la concede',
  ).not.toContain('--no-sandbox');
  expect(daMenu, 'aperto dal menu il link d\'invito non arriva più a Filo').toContain(INVITO);
});

// La manopola che non esiste è il caso normale: su Ubuntu non c'è quella vecchia
// di Debian, su Debian non c'è quella di Ubuntu. Un file assente non deve valere
// «negata» (Filo rinuncerebbe alla gabbia ovunque) né far crollare il lanciatore.
test('una manopola che su questo sistema non esiste non vale una risposta', async () => {
  test.skip(Boolean(soloPosix), String(soloPosix));
  const filo = await lanciatore({});
  const arrivati = ricevuti(execFileSync(filo, [INVITO], { encoding: 'utf8' }));
  expect(arrivati).not.toContain('--no-sandbox');
  expect(arrivati).toContain(INVITO);
});
