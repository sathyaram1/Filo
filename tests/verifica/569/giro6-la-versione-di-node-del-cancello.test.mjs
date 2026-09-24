// Prova del giro 6 sul #569 — «stessa versione di Node del cancello» guarda il
// job sbagliato.
//
// COSA SI GIOCA
//   Il lavoro nuovo su Windows esiste per anticipare il cancello della
//   pubblicazione: stesso sistema, stessa versione di Node, stesso comando. Una
//   sentinella promette di tenerli fermi insieme. La versione del cancello però
//   se la prende dalla PRIMA riga `node-version:` della ricetta, che appartiene
//   a un altro lavoro, su un altro sistema. Oggi le due coincidono e la
//   sentinella dice il vero per caso: cambiata la sola versione del cancello,
//   resterebbe verde mentre il semaforo gira su un motore diverso da quello che
//   poi ferma la pubblicazione.
//
//   Già scritto in un giro passato e mai chiuso, per questo torna qui.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { leggiTestoRepo } from '../../helpers/testo.mjs';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = join(QUI, '..', '..', '..');
const CANCELLO = leggiTestoRepo(join(ROOT, '.github', 'workflows', 'release.yml'));

// I job della ricetta, con l'intervallo di testo che occupano.
function jobs(testo) {
  const inizi = [...testo.matchAll(/^ {2}([A-Za-z0-9_-]+):$/gm)].map((m) => ({ nome: m[1], da: m.index }));
  return inizi.map((j, i) => ({ ...j, a: i + 1 < inizi.length ? inizi[i + 1].da : testo.length }));
}

/** Il job che fa davvero da cancello: su Windows e con gli unit test dentro. */
function jobDelCancello(testo) {
  return jobs(testo).find((j) => {
    const corpo = testo.slice(j.da, j.a);
    return /runs-on:\s*windows-latest/.test(corpo) && /npm run test:unit/.test(corpo);
  });
}

test('#569 giro 6 (taratura): il cancello della pubblicazione è un job su Windows che lancia gli unit test', () => {
  const cancello = jobDelCancello(CANCELLO);
  assert.ok(cancello, 'nella ricetta non si trova più il job che fa gli unit test su Windows');
  assert.match(
    CANCELLO.slice(cancello.da, cancello.a),
    /node-version:\s*\S+/,
    'quel job deve fissare la versione di Node, altrimenti non c\'è niente da confrontare',
  );
});

test('#569 giro 6: la versione di Node che la sentinella confronta è quella del cancello, non quella del primo job', () => {
  // È esattamente la lettura della sentinella (tests/unit/verificaWindows.test.mjs).
  const presa = /node-version:\s*(\S+)/.exec(CANCELLO);
  assert.ok(presa, 'nessuna versione di Node nella ricetta');

  const cancello = jobDelCancello(CANCELLO);
  const dentroIlCancello = presa.index >= cancello.da && presa.index < cancello.a;
  assert.ok(
    dentroIlCancello,
    'la sentinella confronta la prima versione di Node della ricetta, che appartiene al job '
    + `«${jobs(CANCELLO).filter((j) => j.da <= presa.index).pop().nome}» e non al cancello «${cancello.nome}»: `
    + 'oggi le due coincidono e la promessa «stessa macchina del cancello» regge per caso',
  );
});
