// Chiusura di un lavoro locale — SPEC-RIDISEGNO-MAX.md §10
//
// Logica pura di `scripts/finish-local.mjs`. Due cose:
//
//   · quali spec mirati lanciare per le aree toccate;
//   · la SENTINELLA sul fatto che questa macchina non scrive più sul ramo
//     principale. Da quando la fusione la fa il server, una riga che rimettesse
//     qui un `push origin main` (o un passaggio sul ramo principale per fondere
//     in locale) riaprirebbe esattamente il buco che la spec chiude — e nessun
//     test di comportamento se ne accorgerebbe, perché il lavoro arriverebbe su
//     main lo stesso.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { specsForChangedFiles } from '../../scripts/finish-local.mjs';

const SORGENTE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'finish-local.mjs'),
  'utf8'
);

describe('quali spec lanciare', () => {
  test('una pagina toccata porta con sé il suo spec', () => {
    assert.deepEqual(specsForChangedFiles(['src/pages/manage/manage.js']), ['tests/manage']);
  });

  test('uno spec modificato a mano viene incluso così com’è', () => {
    assert.deepEqual(specsForChangedFiles(['tests/editor-chat.spec.mjs']), ['tests/editor-chat']);
  });

  test('niente duplicati quando più file portano allo stesso spec', () => {
    const out = specsForChangedFiles(['src/pages/manage/manage.js', 'src/pages/manage/manage.html']);
    assert.deepEqual(out, ['tests/manage']);
  });

  test('i file fuori dall’app non tirano dentro spec a caso', () => {
    assert.deepEqual(specsForChangedFiles(['README.md', 'scripts/dispatch.mjs', '.gitignore']), []);
  });

  test('lista vuota o non valida non esplode', () => {
    assert.deepEqual(specsForChangedFiles([]), []);
    assert.deepEqual(specsForChangedFiles(null), []);
  });
});

describe('da qui sul ramo principale non si scrive', () => {
  // Le righe di commento raccontano la storia (e nominano main di continuo):
  // la sentinella deve guardare il CODICE.
  const codice = SORGENTE.split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  test('nessuna spedizione verso il ramo principale', () => {
    assert.ok(!/push['"\s,\]]+.*MAIN/.test(codice) && !/push[^\n]*origin[^\n]*main/i.test(codice),
      'il finish locale non deve poter spingere sul ramo principale: la fusione la fa il server');
  });

  test('nessuna fusione fatta in locale', () => {
    assert.ok(!/'merge'/.test(codice) && !/"merge"/.test(codice),
      'nessun git merge da questa macchina: il diff da fondere lo guarda il server');
    assert.ok(!/checkout/.test(codice),
      'niente passaggi sul ramo principale per fondere: non serve più, e cambiare ramo sotto i piedi del lavoro è un rischio in sé');
  });

  test('la fusione si CHIEDE, e il ramo viene spedito prima', () => {
    assert.match(codice, /askServerMerge/, 'la fusione passa dal server');
    assert.match(codice, /push['"\s,\]]+.*branch/, 'il ramo va spedito, o il server non ha niente da guardare');
  });

  test('lavorare direttamente sul ramo principale si ferma subito', () => {
    assert.match(codice, /branch === MAIN/,
      'un lavoro fatto sul ramo principale non ha più modo di arrivare agli utenti: va detto prima dei controlli');
  });
});
