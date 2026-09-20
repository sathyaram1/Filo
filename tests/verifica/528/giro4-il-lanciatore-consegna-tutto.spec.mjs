// Giro 4 di verifica del feedback #528 — «pubblicare Filo-Linux.AppImage».
//
// COSA PROVA
//   Il giro 3 ha trovato che il doppio clic sul pacchetto non apriva Filo, e la
//   correzione ha messo DENTRO il pacchetto un lanciatore: al posto del
//   programma vero c'è ora uno script che guarda le manopole del kernel e, dove
//   la gabbia di sicurezza è negata, avvia Filo senza. Il programma vero è
//   stato spostato accanto, col suffisso `-bin`.
//
//   Mettere uno script in mezzo alla strada di avvio apre due porte nuove, e
//   sono queste che si provano qui. Tutto quello che il sistema consegnava
//   prima direttamente al programma adesso passa da uno script di shell, e uno
//   script di shell è il posto classico dove gli argomenti si perdono, si
//   spezzano sugli spazi o si fanno interpretare.
//
//     1. GLI ARGOMENTI. Su Linux il link d'invito (`filo://invito/...`) arriva
//        a Filo fra gli argomenti: se il lanciatore ne perde uno, o lo spezza
//        in due sullo spazio, il tester clicca l'invito e non gli succede
//        niente. Vale per ogni argomento, anche quelli con spazi, apici,
//        emoji, o vuoti.
//
//     2. IL NOME CON CUI FILO SI PRESENTA. Il lanciatore usa `exec -a` per
//        tenere il nome originale. Senza, il processo si chiamerebbe
//        «filo-bin» e la finestra non si aggancerebbe più alla sua icona nella
//        barra delle applicazioni (è la riga `StartupWMClass=Filo` della voce
//        di menu): l'utente si ritroverebbe una finestra senza icona, o una
//        seconda icona accanto a quella vera.
//
//     3. LA CARTELLA DELL'UTENTE. Il foglietto del primo avvio dice di tenere
//        Filo «in una cartella tua (la home, o una cartella Applicazioni che ti
//        sei fatto)». Una cartella che uno si fa ha spesso uno spazio nel nome,
//        e un percorso non quotato dentro il lanciatore si romperebbe proprio
//        lì — cioè proprio dove il foglietto manda l'utente.
//
// COME L'HO PROVATO, OLTRE A QUESTO FILE
//   Il pacchetto vero, costruito qui, avviato dalla porta del doppio clic
//   (AppImage montato con FUSE) da un utente senza privilegi e con la manopola
//   del kernel che nega gli spazi dei nomi: Filo si apre e resta su, senza
//   nessun errore di gabbia. Il controllo opposto — il programma vero senza il
//   lanciatore, nelle stesse condizioni — muore all'istante. E il lanciatore
//   non spegne la gabbia dove il kernel la concede. Quella prova ha bisogno di
//   privilegi di amministratore e di un pacchetto costruito, quindi non entra
//   in un file che deve girare ovunque: sta scritta nella critica del giro.
//
// PERCHÉ È QUI E NON FRA GLI UNIT TEST
//   È la memoria di questo giro: chi corregge la rilancia con
//   `npx playwright test tests/verifica/528`. Se il difetto si chiude, la
//   guardia permanente va accanto alle altre (tests/unit/linuxSupport.test.mjs).

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

// Il lanciatore è uno script di shell POSIX: su Windows non c'è niente da
// eseguire. Il resto della sua forma lo guardano gli unit test, che girano
// dappertutto.
const soloPosix = process.platform === 'win32'
  ? 'il lanciatore è del pacchetto Linux: qui non c\'è una shell che lo esegua'
  : false;

// Costruisce, con lo STESSO passo che gira dentro la costruzione vera, un
// lanciatore attorno a un finto programma che riporta cosa gli è arrivato.
// `dove` permette di scegliere la cartella (serve per la prova sugli spazi).
async function lanciatoreAttorno(dove) {
  const hook = pkg.build?.afterPack;
  expect(hook, 'build.afterPack sparito: nel pacchetto Linux non entra più nessun lanciatore').toBeTruthy();
  const { default: afterPack } = require_(path.join(RADICE, hook));

  // Il finto programma stampa un argomento per riga, con dei paletti attorno:
  // così si vede anche un argomento vuoto, e uno spezzato in due si nota
  // perché diventa due righe.
  fs.writeFileSync(path.join(dove, 'filo'), '#!/bin/sh\nfor a in "$@"; do echo "[$a]"; done\n', { mode: 0o755 });
  await afterPack({
    electronPlatformName: 'linux',
    appOutDir: dove,
    packager: { executableName: 'filo', appInfo: { productFilename: 'Filo' } },
  });
  fs.chmodSync(path.join(dove, 'filo'), 0o755);
  return path.join(dove, 'filo');
}

// Quello che il lanciatore aggiunge di suo (`--no-sandbox`, dove il kernel
// nega la gabbia) non è un argomento dell'utente: si toglie prima di
// confrontare.
function argomentiRicevuti(uscita) {
  return String(uscita)
    .split('\n')
    .filter((r) => r.startsWith('[') && r.endsWith(']'))
    .map((r) => r.slice(1, -1))
    .filter((a) => a !== '--no-sandbox');
}

test('il link d\'invito, e ogni altro argomento, arriva a Filo esattamente com\'era', async () => {
  test.skip(Boolean(soloPosix), String(soloPosix));
  const lanciatore = await lanciatoreAttorno(cartellaTemporanea('filo-528-giro4-argomenti-'));

  // Il primo è il link d'invito: su Linux è così che arriva a Filo. Gli altri
  // sono i modi classici in cui uno script di shell rovina quello che gli
  // passa.
  const mandati = [
    'filo://invito/ABC-123',
    'un argomento con spazi',
    'apici \'singoli\' e "doppi"',
    'emoji 🎉 e accenti àèì',
    '$(whoami) `id` ${HOME}',   // non deve essere interpretato: è testo
    '; rm -rf /',
    '--no-zygote',
    '',                          // un argomento vuoto resta un argomento
  ];
  const ricevuti = argomentiRicevuti(execFileSync(lanciatore, mandati, { encoding: 'utf8' }));

  expect(
    ricevuti,
    'il lanciatore non consegna a Filo gli argomenti che ha ricevuto: il link d\'invito cliccato '
    + 'nel browser arriverebbe storto o non arriverebbe affatto, e chi ha cliccato non vedrebbe niente',
  ).toEqual(mandati);
});

test('Filo si presenta al sistema con il suo nome, non con quello del programma nascosto', async () => {
  test.skip(Boolean(soloPosix), String(soloPosix));
  const dove = cartellaTemporanea('filo-528-giro4-nome-');
  const lanciatore = await lanciatoreAttorno(dove);
  const scritto = fs.readFileSync(lanciatore, 'utf8');

  // `exec -a <nome>` è ciò che tiene il nome originale del processo. Senza, il
  // processo si chiama «filo-bin»: la finestra non trova più la sua voce di
  // menu (StartupWMClass=Filo) e resta senza icona nella barra.
  const riga = scritto.split('\n').find((r) => r.includes('exec ')) || '';
  expect(
    riga,
    'il lanciatore avvia Filo senza tenergli il nome: la finestra non si aggancia più alla sua icona nella barra',
  ).toMatch(/exec\s+-a\s+"\$QUI\/filo"/);
  expect(
    riga,
    'il lanciatore non avvia il programma vero',
  ).toMatch(/"\$QUI\/filo-bin"/);
});

test('Filo parte anche da una cartella con uno spazio nel nome, come dice il foglietto', async () => {
  test.skip(Boolean(soloPosix), String(soloPosix));
  // Il foglietto del primo avvio manda l'utente a tenere Filo «in una cartella
  // tua»: una cartella che uno si fa ha spesso uno spazio nel nome.
  const base = cartellaTemporanea('filo-528-giro4-spazi-');
  const dove = path.join(base, 'Le mie Applicazioni');
  fs.mkdirSync(dove, { recursive: true });
  const lanciatore = await lanciatoreAttorno(dove);

  const ricevuti = argomentiRicevuti(execFileSync(lanciatore, ['filo://invito/ABC-123'], { encoding: 'utf8' }));
  expect(
    ricevuti,
    'da una cartella col nome spezzato da uno spazio il lanciatore non trova più il programma vero, '
    + 'o gli consegna un percorso a metà: Filo non si apre, e il foglietto manda l\'utente proprio lì',
  ).toEqual(['filo://invito/ABC-123']);
});
