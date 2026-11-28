// #2678.21: la password con un refuso ai bordi della parola, un tasto sbagliato nel verbo, o la «e» senza accento dopo
// un inciso, un avverbio o nel tempo composto non arriva ai modelli; la congiunzione davanti a un nome resta intera.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const P = globalThis.SN_PAVIMENTO;
const C = require(join(ROOT, 'src', 'main', 'services', 'correttoreRiservati.js'));
const V = 'Mela!Verde77';

const fughe = (frasi) => frasi.filter((t) => /mela/i.test(P.oscura(t)) || /mela/i.test(C.oscura(t)));

test('la «e» senza accento dopo un inciso, un avverbio o nel tempo composto', () => {
  assert.deepEqual(fughe([
    `la password, che era vecchia, e ${V}`, `la password, credo, e ${V}`, `la password, se non sbaglio, e ${V}`,
    `la password (quella nuova) e ${V}`, `la password - te lo dico - e ${V}`, `la pasword, che era vecchia, e ${V}`,
    `la password ora e ${V}`, `la password adesso e ${V}`, `la password e stata cambiata in ${V}`,
    `la password e cambiata in ${V}`, 'LA PASSWORD, CHE ERA VECCHIA, E MELA!VERDE77',
  ]), []);
});

test('un tasto sbagliato nel verbo', () => {
  assert.deepEqual(fughe([
    `the password si ${V}`, `the password iz ${V}`, `my password ia ${V}`, `la password diventta ${V}`, `la password rimae ${V}`,
    `la password è statta cambiata in ${V}`, `la password è stata cambita in ${V}`, `la password è' ${V}`, `la password e\` ${V}`,
    `la password, se non sbaglio, è' ${V}`, `ho cmbiato la password in ${V}`, `ho cambito la password in ${V}`,
  ]), []);
});

test('un refuso sulla prima o sull’ultima lettera della parola', () => {
  const frasi = [];
  for (const w of ['passwor', 'passworf', 'passwore', 'passwordf', 'oassword', 'lassword', 'apssword', 'assword', 'paswd']) {
    frasi.push(`la ${w} è ${V}`, `the ${w} is ${V}`);
  }
  assert.deepEqual(fughe(frasi), []);
});

test('il valore che comincia con un refuso di «password» resta un valore', () => {
  for (const v of ['Pasword!77', 'Paswd!2024', 'Passwor!9']) assert.equal(P.oscura(`la password è ${v}`), `la password è ${P.SEGNAPOSTO}`, v);
});

test('il correttore legge refusi e inciso anche per le password di sole parole', () => {
  for (const t of ['la pasword è gattonero', 'la passwrd è stata cambiata in gattonero', 'la password, che era vecchia, è gattonero',
    'la passwor è gattonero', 'ho cmbiato la password in gattonero']) assert.doesNotMatch(C.oscura(t), /gattonero/, t);
});

test('la congiunzione, i plurali e le parole vicine restano intere', () => {
  for (const t of ['la password e Office365 sono collegati', 'la password e Windows11 non vanno d’accordo',
    'la password e Office365 li ho configurati', 'the password in the file is old', 'la password si trova nel cassetto',
    'la password si cambia ogni mese', 'the passwords are in the vault', 'il passaporto è scaduto', 'la passwor è scaduta',
    'la oassword è sbagliata', 'la password ora non va', 'la password (quella nuova) non va', 'la password, comunque, è sbagliata',
    'ho cambiato idea sulla password', 'la password diventa obsoleta', 'il passed test è Ok2024', 'ho passato il passport al controllo']) {
    assert.equal(P.oscura(t), t, t);
  }
  for (const t of ['the passwords are in the vault', 'la password si trova nel cassetto', 'la passwor è scaduta']) assert.equal(C.oscura(t), t, t);
});
