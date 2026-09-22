// Giro 5 di verifica del feedback #528 — «pubblicare Filo-Linux.AppImage».
//
// COSA PROVA
//   Che la gabbia di sicurezza di Chromium resti accesa da OGNI strada con cui
//   si apre Filo su Linux, non solo da una.
//
//   Filo è un browser: apre siti qualunque, e quella gabbia è la barriera fra
//   quei siti e il resto del computer. Il pacchetto Linux porta dentro di sé un
//   lanciatore che guarda le manopole del kernel e rinuncia alla gabbia SOLO
//   dove il sistema la nega. La voce di menu del pacchetto però chiede
//   `--no-sandbox` sempre, senza guardare niente: la scrive electron-builder e
//   non si può toglierle. Chi integra Filo fra le applicazioni passa di lì, ed
//   è quello che Ubuntu propone al primo doppio clic; è anche l'unico modo
//   perché il link d'invito apra Filo. Se quella richiesta arrivasse fino a
//   Chromium, quegli utenti navigherebbero scoperti su ogni macchina che la
//   gabbia la concede.
//
// COME L'HO VISTO
//   Pacchetto costruito qui, estratto, avviato da un utente senza privilegi su
//   una macchina che la gabbia la concede. Aperto come fa il doppio clic,
//   nessun processo di Filo riceveva `--no-sandbox`. Aperto come fa la voce di
//   menu, lo ricevevano il renderer, la GPU e i processi di servizio.
//
// PERCHÉ È QUI E NON FRA GLI UNIT TEST
//   È la memoria di questo giro: chi corregge la rilancia con
//   `npx playwright test tests/verifica/528`. La guardia permanente sta accanto
//   alle altre, in tests/unit/linuxSupport.test.mjs.

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

// Le manopole del kernel che portano Chromium a non partire affatto. Dove
// rispondono così, rinunciare alla gabbia è l'unico modo di aprire Filo.
function gabbiaNegata() {
  const leggi = (p) => { try { return fs.readFileSync(p, 'utf8').trim(); } catch (_) { return null; } };
  return leggi('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1'
    || leggi('/proc/sys/user/max_user_namespaces') === '0'
    || leggi('/proc/sys/kernel/unprivileged_userns_clone') === '0';
}

// Il lanciatore vero, costruito dallo stesso passo che gira nella costruzione
// del pacchetto, attorno a un finto programma che riporta cosa gli è arrivato.
async function lanciatore() {
  const hook = pkg.build?.afterPack;
  expect(hook, 'build.afterPack sparito: nel pacchetto Linux non entra più nessun lanciatore').toBeTruthy();
  const { default: afterPack } = require_(path.join(RADICE, hook));
  const dove = cartellaTemporanea('filo-528-giro5-');
  fs.writeFileSync(path.join(dove, 'filo'), '#!/bin/sh\nfor a in "$@"; do echo "[$a]"; done\n', { mode: 0o755 });
  await afterPack({
    electronPlatformName: 'linux',
    appOutDir: dove,
    packager: { executableName: 'filo', appInfo: { productFilename: 'Filo' } },
  });
  fs.chmodSync(path.join(dove, 'filo'), 0o755);
  return path.join(dove, 'filo');
}

const ricevuti = (uscita) => String(uscita).split('\n')
  .filter((r) => r.startsWith('[') && r.endsWith(']'))
  .map((r) => r.slice(1, -1));

test('la gabbia la decide il sistema, da qualunque strada si apra Filo', async () => {
  test.skip(Boolean(soloPosix), String(soloPosix));
  const filo = await lanciatore();
  const negata = gabbiaNegata();
  const invito = 'filo://invito/ABC-123';

  // La strada del doppio clic: il sistema non aggiunge niente di suo.
  const doppioClic = ricevuti(execFileSync(filo, [invito], { encoding: 'utf8' }));
  expect(doppioClic).toContain(invito);
  expect(
    doppioClic.includes('--no-sandbox'),
    negata
      ? 'qui il kernel nega gli spazi dei nomi e col doppio clic Filo non si aprirebbe'
      : 'qui il kernel concede gli spazi dei nomi e col doppio clic Filo rinuncia lo stesso alla gabbia',
  ).toBe(negata);

  // La strada del menu delle applicazioni, e quella del link d'invito: il
  // sistema aggiunge `--no-sandbox` per conto suo, senza aver guardato niente.
  const daMenu = ricevuti(execFileSync(filo, ['--no-sandbox', invito], { encoding: 'utf8' }));
  expect(daMenu, 'aperto dal menu il link d\'invito non arriva più a Filo').toContain(invito);
  expect(
    daMenu.includes('--no-sandbox'),
    negata
      ? 'aperto dal menu delle applicazioni Filo non parte: dove il kernel nega la gabbia va spenta anche di lì'
      : 'chi apre Filo dal menu delle applicazioni, o clicca un link d\'invito, naviga senza la gabbia '
        + 'anche su una macchina che la concede: la voce di menu la spegne sempre e nessuno la ferma',
  ).toBe(negata);
});
