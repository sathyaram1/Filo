// Verifica #551 — giro 6. La stessa porta del SECONDO giro, chiusa in un punto
// solo.
//
// Il secondo giro aveva trovato che l'uscita di un comando, tagliata al tetto,
// poteva finire con mezza emoji — una metà di carattere che si mostra come un
// rombo. La cura è stata messa dove il terminale tiene l'uscita (dodicimila
// caratteri) e la prova di quel giro passa. Ma non è quello il taglio che conta:
// prima di arrivare al modello l'uscita passa dalla busta con cui ogni
// contenuto esterno entra nel prompt, e LÌ viene tagliata di nuovo, molto più
// corta, con una fetta che cade in mezzo a un carattere.
//
// Vale per tutto quello che entra imbustato — l'uscita di un comando, un
// estratto di pagina, i risultati di una ricerca — non solo per i comandi.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function bustaEsito(testo, max) {
  require('../../../src/shared/contenutoEsterno.js');
  return globalThis.SN_ESTERNO.imbusta({
    tipo: 'ESITO_COMANDO', testo, conIntestazione: false, max,
  });
}

test('il taglio con cui l’uscita di un comando arriva al modello non spezza un carattere', () => {
  // Il tetto con cui l'uscita di un comando viene imbustata oggi.
  const MAX = 4000;
  const spezzati = [];
  // La posizione del taglio dipende da quanto testo c'è prima: si prova una
  // manciata di lunghezze, come capita a un elenco di file vero.
  for (let pad = 3925; pad <= 3940; pad++) {
    const uscita = 'x'.repeat(pad) + '😀'.repeat(60);
    const busta = bustaEsito(uscita, MAX);
    const fine = busta.indexOf('\n(contenuto più lungo');
    const corpo = fine === -1 ? busta : busta.slice(0, fine);
    const ultimo = corpo.charCodeAt(corpo.length - 1);
    if (ultimo >= 0xD800 && ultimo <= 0xDBFF) spezzati.push(pad);
  }
  expect(
    spezzati,
    'il taglio della busta lascia in fondo mezza emoji: è la porta del secondo giro, '
    + 'chiusa dove il terminale tiene l’uscita e rimasta aperta dove l’uscita arriva al modello',
  ).toEqual([]);
});
