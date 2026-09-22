// Giro 1 di verifica del feedback #528 — la porta del PRIMO AVVIO su Linux.
//
// IL SINTOMO
//   Il tester scarica Filo-Linux.AppImage dal sito e ci fa doppio clic. Non
//   succede niente. Due motivi, tutti e due certi e tutti e due invisibili:
//
//   1. Un file scaricato da un browser arriva senza il permesso di essere
//      eseguito (0644). Un AppImage senza quel permesso e' un file qualunque:
//      il doppio clic lo apre con un editor di testo, o non fa nulla. Va dato
//      il permesso a mano (Proprieta' -> "Consenti l'esecuzione", oppure
//      `chmod +x`).
//   2. Il pacchetto e' un AppImage di tipo 2 (i byte 8-10 del file sono
//      `41 49 02`) e per montarsi apre `libfuse.so.2`. Ubuntu dalla 22.04,
//      Debian 12 e Fedora recenti NON la installano piu' di serie: li' il
//      doppio clic muore con «dlopen(): error loading libfuse.so.2». Va
//      installata (`libfuse2`), oppure l'AppImage va estratto
//      (`--appimage-extract`).
//
//   In tutti e due i casi l'utente e' bloccato PRIMA di aver visto Filo: una
//   spiegazione che vive dentro Filo non la leggera' mai. E' la stessa regola
//   gia' scritta nel repo per il Mac senza certificato Apple, dove
//   l'istruzione sta dentro il disco che l'utente ha appena aperto
//   ("Se Filo non si apre.txt", allegato dal build.dmg).
//
//   Un AppImage e' un file solo: non ha un "dentro" dove mettere il foglietto.
//   Percio' l'istruzione deve stare dove l'utente arriva comunque: un secondo
//   allegato accanto all'AppImage nella stessa pubblicazione, oppure il testo
//   della pubblicazione stessa. Questo test non impone quale: chiede che ce ne
//   sia almeno una.
//
//   QUESTO TEST E' ROSSO finche' quella spiegazione non esiste da nessuna
//   parte: e' la porta aperta del giro 1.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => fs.readFileSync(path.join(RADICE, p), 'utf8');
const esiste = (p) => fs.existsSync(path.join(RADICE, p));

// Le parole con cui si riconosce che lo sblocco e' stato spiegato: il permesso
// di esecuzione e la libreria che manca. Bastano i concetti, non le frasi.
const PARLA_DI_PERMESSO = /chmod|esegu|eseguibile|Consenti l'esecuzione|executable/i;
const PARLA_DI_FUSE = /fuse/i;

test('per il Mac bloccato al primo avvio l\'istruzione esiste gia\': e\' il termine di paragone', () => {
  // Se un giorno cade anche questa, il paragone qui sotto non vale piu'.
  expect(esiste('build/Se Filo non si apre.txt'),
    'il foglietto del Mac non c\'e\' piu\': il paragone di questo test e\' saltato').toBe(true);
  const pkg = JSON.parse(leggi('package.json'));
  const dentroIlDisco = JSON.stringify(pkg.build.dmg || {});
  expect(dentroIlDisco, 'il foglietto del Mac non viene piu\' allegato al disco').toContain('Se Filo non si apre');
});

test('su Linux l\'utente bloccato al primo avvio trova la stessa spiegazione, fuori da Filo', () => {
  // 1) Un foglietto per Linux fra i file del progetto, allegato alla
  //    pubblicazione accanto all'AppImage?
  let spiegazione = '';
  const cartellaBuild = path.join(RADICE, 'build');
  if (fs.existsSync(cartellaBuild)) {
    for (const nome of fs.readdirSync(cartellaBuild)) {
      if (!/\.(txt|md)$/i.test(nome)) continue;
      const testo = fs.readFileSync(path.join(cartellaBuild, nome), 'utf8');
      if (PARLA_DI_PERMESSO.test(testo) || PARLA_DI_FUSE.test(testo)) spiegazione += `\n${testo}`;
    }
  }

  // 2) Oppure il testo della pubblicazione, scritto dal lavoro che pubblica.
  const yml = leggi('.github/workflows/release.yml');
  const iniz = yml.indexOf('\n  release-linux:');
  if (iniz > -1) {
    const blocco = yml.slice(iniz);
    if (/release edit|notes|--notes-file|body/i.test(blocco)) spiegazione += `\n${blocco}`;
  }

  expect(PARLA_DI_PERMESSO.test(spiegazione),
    'niente spiega al tester Linux che il file scaricato va reso eseguibile prima del doppio clic')
    .toBe(true);
  expect(PARLA_DI_FUSE.test(spiegazione),
    'niente spiega al tester Linux cosa fare quando il sistema non ha piu\' libfuse2: li\' il doppio clic muore senza dire nulla')
    .toBe(true);
});

test('il recap degli aggiornamenti non promette un doppio clic che non funziona', () => {
  const notes = leggi('src/shared/patchNotes.js');
  const righeLinux = notes.split('\n').filter((r) => /Linux/i.test(r));
  expect(righeLinux.length, 'il recap non parla della versione Linux').toBeGreaterThan(0);

  for (const riga of righeLinux) {
    if (!/doppio clic/i.test(riga)) continue;
    // Se promette il doppio clic, deve dire anche cosa fare quando non basta.
    expect(PARLA_DI_PERMESSO.test(riga) || PARLA_DI_FUSE.test(riga),
      'il recap promette «si apre con un doppio clic»: su un AppImage appena scaricato non e\' vero, e non dice cosa fare')
      .toBe(true);
  }
});
