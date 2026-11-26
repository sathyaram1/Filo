// #1403.11 — fra virgolette con lo spazio dentro (la grafia francese, «la password è « Mela!Verde77 »») la password si
// toglie come senza spazi, e il resto del testo resta com'era, virgolette e spazi compresi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../src/shared/pavimento.js');
const S = P.SEGNAPOSTO;

test('la password fra virgolette con lo spazio dentro diventa il segnaposto, con ogni tipo di virgolette', () => {
  for (const [a, c] of [['«', '»'], ['»', '«'], ['“', '”'], ['„', '“'], ['"', '"'], ["'", "'"], ['‹', '›'], ['「', '」']]) {
    for (const w of [' ', '  ', ' ', ' ']) {
      const frase = `la password è ${a}${w}Mela!Verde77${w}${c}`;
      assert.equal(P.oscura(frase), `la password è ${a}${w}${S}${w}${c}`, JSON.stringify(frase));
    }
  }
  assert.equal(P.oscura('the password is “ Mela!Verde77 ”, ok?'), `the password is “ ${S} ”, ok?`);
  assert.equal(P.oscura('Password:\n« Mela!Verde77 »'), `Password:\n« ${S} »`);
  assert.equal(P.oscura('il codice di accesso è « 482913 »'), `il codice di accesso è « ${S} »`);
});

test('il valore trovato è quello fra le virgolette, senza spazi né virgolette attaccate', () => {
  assert.deepEqual([...new Set(P.trova('la password è » Mela!Verde77 «').map((x) => x.valore))], ['Mela!Verde77']);
});

test('una parola qualunque al posto della password si toglie solo lì, anche fra virgolette con lo spazio', () => {
  assert.equal(P.oscura('Password: « hunter »\nil film hunter mi è piaciuto'), `Password: « ${S} »\nil film hunter mi è piaciuto`);
});

test('nelle lingue delle etichette anche il verbo chiude l\'etichetta, con o senza virgolette', () => {
  for (const [prima, dopo] of [
    ['le mot de passe est « ', ' »'], ['Votre mot de passe est « ', ' ».'], ['le mot de passe était ', ''],
    ['Das Passwort ist « ', ' »'], ['Das Kennwort lautet ', ''], ['la contraseña es « ', ' »'],
    ['a senha é « ', ' »'], ['het wachtwoord luidt ', ''], ['Hasło to ', ''], ['hasło jest « ', ' »'],
  ]) assert.equal(P.oscura(`${prima}Mela!Verde77${dopo}`), `${prima}${S}${dopo}`, prima);
  for (const frase of [
    'send the password to mario@example.com',
    'Le mot de passe est obligatoire',
    'Das Passwort ist falsch',
    'la contraseña es incorrecta',
  ]) assert.equal(P.oscura(frase), frase);
});

test('un apostrofo dentro la password non chiude le virgolette con lo spazio', () => {
  for (const frase of ["la password è « l'Albero77 »", 'Password: « l’Albero77 »', "mot de passe : « l'Albero77 »"]) {
    assert.equal(P.oscura(frase).includes('Albero77'), false, frase);
  }
  assert.equal(P.oscura("l'amico « Mario » dice « l'altra volta »"), "l'amico « Mario » dice « l'altra volta »");
});

test('le virgolette con lo spazio che non portano una password restano come sono', () => {
  for (const frase of [
    'Ho detto « ciao » a Marco',
    'Password: « deve avere almeno otto caratteri »',
    "dell' altro giorno ricordo solo « il mare »",
    'il titolo è “ La casa ” e basta',
  ]) assert.equal(P.oscura(frase), frase);
});
