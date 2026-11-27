// #2678.21 giro 2: password dette con la «e» senza accento seguita da un'altra parola, con un inciso in forme meno
// comuni, con un refuso nei verbi «era», «was», «diventata»; e la congiunzione che non deve nascondere il nome vicino.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(`../../../src/shared/${m}.js`);
const P = globalThis.SN_PAVIMENTO;
const C = require('../../../src/main/services/correttoreRiservati.js');

const nascosta = (frasi) => {
  for (const t of frasi) {
    expect(P.oscura(t), `pavimento: ${t}`).not.toMatch(/Verde77/i);
    expect(C.oscura(t), `correttore: ${t}`).not.toMatch(/Verde77/i);
  }
};

test('r1 la «e» senza accento seguita da un participio o da un avverbio, o dopo un complemento in due pezzi', () => {
  nascosta([
    'la password e diventata Mela!Verde77',
    'la password e rimasta Mela!Verde77',
    'la password e ancora Mela!Verde77',
    'la password e sempre Mela!Verde77',
    'la password e ora Mela!Verde77',
    'la password ora e diventata Mela!Verde77',
    'la password del router di casa e Mela!Verde77',
    'la password del router di Mario, credo, e Mela!Verde77',
  ]);
});

test('r2 un inciso dopo un complemento in due pezzi, fra punti e virgola, fra quadre o fra trattini attaccati', () => {
  nascosta([
    'la password del wifi di Mario, che era vecchia, è Mela!Verde77',
    'la password del wifi di casa, che era vecchia, è Mela!Verde77',
    'la password; che era vecchia; è Mela!Verde77',
    'la password [quella nuova] è Mela!Verde77',
    'la password -che era vecchia- è Mela!Verde77',
  ]);
});

test('r3 un tasto sbagliato in «era», «was» e «diventata»', () => {
  nascosta([
    'la password ear Mela!Verde77',
    'la password erra Mela!Verde77',
    'the password wsa Mela!Verde77',
    'the password eas Mela!Verde77',
    'la password è diventaya Mela!Verde77',
    'la password è divenata Mela!Verde77',
  ]);
});

test('r4 la congiunzione davanti a un nome con cifre lascia il nome', () => {
  for (const t of [
    'la password e Office365 non c\'entrano niente',
    'ho dimenticato la password e Office365 non parte',
    'uso la password e Windows11 tutti i giorni',
    'la password e Office365 mi danno errore',
  ]) expect(P.oscura(t), t).toBe(t);
});
