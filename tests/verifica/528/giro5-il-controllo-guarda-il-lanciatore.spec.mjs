// Giro 5 di verifica del feedback #528 — «pubblicare Filo-Linux.AppImage».
//
// COSA PROVA
//   Che il controllo che COSTRUISCE e AVVIA davvero il pacchetto Linux riparta
//   quando si tocca il pezzo che lo fa aprire. È l'unica prova che risponde a
//   «col doppio clic si apre ancora?», e oggi si accende per la ricetta del
//   pacchetto, per l'icona e per la sentinella, ma non per il lanciatore messo
//   dentro al pacchetto — cioè la cosa che fa funzionare il doppio clic.
//
//   Stessa lacuna sul lato Mac: lo smistatore comune decide se la firma per Mac
//   viene messa, e nessuno dei due controlli riparte quando lo si tocca.
//
//   Il rilievo è del giro 4 e non è stato chiuso: questa prova lo fissa perché
//   il giro dopo lo ritrovi da solo.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// I percorsi elencati sotto `push: paths:` del lavoro, letti a mano: sono righe
// con un trattino e una stringa fra apici, e non serve un lettore di YAML.
function percorsiOsservati(nomeFile) {
  const testo = fs.readFileSync(path.join(RADICE, '.github', 'workflows', nomeFile), 'utf8');
  const dopoPaths = testo.split(/^\s*paths:\s*$/m)[1] || '';
  const fine = dopoPaths.search(/^\S/m);
  const blocco = fine === -1 ? dopoPaths : dopoPaths.slice(0, fine);
  return [...blocco.matchAll(/^\s*-\s*'([^']+)'/gm)].map((m) => m[1]);
}

// Un elenco copre un file se lo nomina o se lo prende dentro con una stella.
function copre(percorsi, file) {
  return percorsi.some((p) => {
    if (p === file) return true;
    const stella = p.indexOf('*');
    return stella !== -1 && file.startsWith(p.slice(0, stella));
  });
}

test('il controllo che apre davvero il pacchetto Linux riparte se cambia il lanciatore', () => {
  const osservati = percorsiOsservati('verifica-linux.yml');
  expect(
    copre(osservati, 'scripts/after-pack-linux.js'),
    'il controllo che costruisce e avvia il pacchetto Linux non riparte quando cambia il lanciatore '
    + 'che il pacchetto si porta dentro: è esattamente il pezzo che fa aprire Filo col doppio clic, '
    + 'e l\'unica prova che se ne accorge non guarda da quella parte',
  ).toBe(true);
});

test('lo smistatore comune accende tutti e due i controlli che ne dipendono', () => {
  const linux = percorsiOsservati('verifica-linux.yml');
  const mac = percorsiOsservati('verifica-mac.yml');
  const smistatore = 'scripts/after-pack.js';
  expect(
    copre(linux, smistatore),
    'il controllo del pacchetto Linux non riparte quando cambia il passo comune che chiama il lanciatore',
  ).toBe(true);
  expect(
    copre(mac, smistatore),
    'il controllo del pacchetto Mac non riparte quando cambia il passo comune che decide se la firma viene messa',
  ).toBe(true);
});
