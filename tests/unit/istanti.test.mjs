// L'istante «poco fa, ma dentro oggi» — tests/helpers/istanti.mjs.
//
// PERCHÉ ESISTE QUESTO CONTROLLO
//   Due spec delle statistiche dei feedback costruivano un fatto «di dodici ore
//   fa» e poi guardavano la finestra «Oggi». «Oggi» parte dalla mezzanotte,
//   quindi prima di mezzogiorno quel fatto cadeva ieri: i due controlli erano
//   verdi mezza giornata e rossi l'altra metà, e il lavoro di release — che
//   parte ogni sei ore — ne avrebbe trovato uno rosso una volta su due.
//   `oggiFa` esiste per non riscrivere quel difetto, e questo controllo tiene
//   chiusa la porta a qualunque ora giri la suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oggiFa, mezzanotte } from '../helpers/istanti.mjs';

const ORA = 60 * 60 * 1000;

test('oggiFa non esce mai da oggi, a qualunque ora del giorno', () => {
  const inizio = mezzanotte();
  const adesso = Date.now();
  for (const ore of [0, 0.1, 1, 9.6, 12, 23, 47, 1000]) {
    const t = new Date(oggiFa(ore)).getTime();
    assert.ok(Number.isFinite(t), `oggiFa(${ore}) non è una data`);
    assert.ok(t >= inizio, `oggiFa(${ore}) cade prima della mezzanotte di oggi`);
    assert.ok(t <= adesso + 5000, `oggiFa(${ore}) cade nel futuro`);
  }
});

test('oggiFa tiene l\'ordine fra due istanti anche quando tocca il fondo', () => {
  const primo = new Date(oggiFa(12, 1000)).getTime();
  const secondo = new Date(oggiFa(9.6, 2000)).getTime();
  assert.ok(primo <= secondo, 'il passaggio prima non risulta prima di quello dopo');
});

test('oggiFa rispetta le ore chieste quando ci stanno dentro la giornata', () => {
  const adesso = Date.now();
  const oreTrascorse = (adesso - mezzanotte(adesso)) / ORA;
  if (oreTrascorse < 3) return;   // troppo presto: il caso è l'altro, già provato
  const t = new Date(oggiFa(2)).getTime();
  assert.ok(Math.abs((adesso - t) - 2 * ORA) < 5000, 'due ore fa non sono due ore fa');
});
