// Verifica #510, giro 2 — un sorgente che gli strumenti non sanno leggere.
//
// La segnalazione non parlava solo di tempo perso: diceva che una prova
// entrata nella suite si era portata dentro un byte nullo, e che da lì in poi
// git quel file lo trattava come un blocco opaco. Il byte nullo è sparito;
// qui la stessa domanda si gira agli strumenti veri, e per intero: un sorgente
// che non si legge riga per riga non si confronta, non si rivede e non si
// fonde — e la scoperta arriva mesi dopo, quando qualcuno prova a fonderlo.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SORGENTI = /\.(mjs|js|cjs|json|md|html|css|txt|sh|yml|yaml)$/;

// Si chiede a git com'è fatto ogni file che ha in casa: è lui a decidere se un
// sorgente è testo, non noi guardando i byte da fuori.
function sorgentiTracciati() {
  const out = execFileSync('git', ['ls-files', '--eol'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  });
  return out.split('\n').filter(Boolean).map((riga) => {
    const taglio = riga.indexOf('\t');
    return {
      forma: riga.slice(0, taglio).trim().split(/\s+/)[0] || '',
      nome: riga.slice(taglio + 1).replace(/\\/g, '/'),
    };
  }).filter((x) => SORGENTI.test(x.nome));
}

test('nessun sorgente del repo è un blocco opaco per gli strumenti', () => {
  const opachi = sorgentiTracciati().filter((x) => x.forma === 'i/-text').map((x) => x.nome);
  expect(opachi,
    'di un file così non si vede il contenuto che cambia: la revisione lo salta e la fusione si ferma')
    .toEqual([]);
});

test('ogni sorgente ha una sola forma di fine riga, la stessa per tutti', () => {
  const storti = sorgentiTracciati()
    .filter((x) => x.forma === 'i/crlf' || x.forma === 'i/mixed')
    .map((x) => `${x.nome} (${x.forma.replace('i/', '')})`);
  expect(storti,
    'una fine riga diversa dalle altre rende il file impossibile da fondere riga per riga, e fa'
    + ' sbagliare ogni controllo che guarda la fine di una riga')
    .toEqual([]);
});
