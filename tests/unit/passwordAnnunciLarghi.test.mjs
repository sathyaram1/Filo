// #2678.7: la password annunciata da un verbo di cambio, da un modale o con un avverbio, e quella dopo «pass», la barra,
// il complemento o la freccia, non arriva al modello (pavimento) né al correttore, con o senza virgolette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/urlExfil.js');
const P = require('../../src/shared/pavimento.js');
const R = require('../../src/main/services/correttoreRiservati.js');

const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra: '' }).nuovo;
const PRIMA = ['la password diventa', 'la password resta', 'la password rimane', 'la password dovrebbe essere',
  'la password potrebbe essere', 'la password è sempre', 'la password è ancora', 'the password will be',
  'the password should be', 'la password dev’essere', 'credo che la password sia', 'pass', 'user mario pass',
  'login: mario /', 'la password del wifi', 'password ->', 'password =>',
  'Ciao Marco, ti confermo che la password del wifi rimane',
  // Al passato, nei tempi composti e detta da chi l'ha cambiata.
  'la password è diventata', 'la password è rimasta', 'la password è stata', 'la password è sempre stata',
  'la password era stata', 'la password è cambiata in', 'la password è stata cambiata in', 'la password è stata impostata a',
  'la password diventò', 'la password è di nuovo', 'ho cambiato la password in', 'ho impostato la password a',
  'abbiamo aggiornato la password del wifi a', 'the password has been', 'the password has become', 'the password became',
  'the password remained', 'the password will become', 'the password was changed to', 'the password was set to',
  'password changed to', 'I changed my password to', "I've set the password to"];
const VALORI = ['Mela!Verde77', '«Mela!Verde77»', '"Mela!Verde77"', '“Mela!Verde77”'];

test('le frasi della segnalazione arrivano al modello col segnaposto al posto della password', () => {
  for (const p of PRIMA) {
    for (const v of VALORI) {
      const t = `${p} ${v}`;
      const fuori = P.oscura(t);
      assert.ok(!fuori.includes('Mela'), `${t} → ${fuori}`);
      assert.ok(fuori.startsWith(p) && fuori.includes(P.SEGNAPOSTO), `${t} → ${fuori}`);
    }
  }
});

test('le stesse frasi non partono verso il correttore', () => {
  for (const p of PRIMA) {
    for (const v of VALORI) {
      const t = `${p} ${v}`;
      const fuori = alCorrettore(t);
      assert.ok(!fuori.includes('Mela'), `${t} → ${fuori}`);
    }
  }
});

test('il pin annunciato da un verbo di cambio resta fuori come col verbo «è»', () => {
  for (const t of ['il pin diventa 4821', 'il pin resta 4821', 'il pin rimane 4821']) assert.ok(!P.oscura(t).includes('4821'), t);
});

test('le frasi che parlano della password senza darla restano intere', () => {
  for (const t of ['Account -> Password -> Cambia', 'Impostazioni -> Password -> "Modifica"', 'la password di Office365',
    'la password di Office365 scade domani', 'la password del wifi non va', 'la password resta segreta',
    'la password deve essere lunga almeno otto caratteri', 'the password should be changed', 'la password è sempre la stessa',
    'la password è ancora quella di prima', 'pass «Gestisci account»']) {
    assert.equal(P.oscura(t), t, t);
  }
});
