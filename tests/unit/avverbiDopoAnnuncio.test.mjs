// #2678.9 — un avverbio fra il verbo e il valore («il pin è ancora 4821», «the pin is still 4821») non fa passare PIN e
// password: non arrivano al modello né escono da un'azione senza conferma. L'elenco degli avverbi è uno solo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
require(join(ROOT, 'src', 'shared', 'guardianoStatico.js'));
const G = globalThis.SN_GUARDIANO_STATICO;
const P = require(join(ROOT, 'src', 'shared', 'pavimento.js'));
const R = require(join(ROOT, 'src', 'shared', 'riservatiNelTesto.js'));
const S = P.SEGNAPOSTO;

test('le frasi della segnalazione arrivano al modello col segnaposto al posto del valore', () => {
  for (const [frase, atteso] of [
    ['il pin è ancora 4821', `il pin è ancora ${S}`],
    ['il pin è sempre 4821', `il pin è sempre ${S}`],
    ['il pin è ora 4821', `il pin è ora ${S}`],
    ['the pin is still 4821', `the pin is still ${S}`],
    ['la password è ancora casa1234', `la password è ancora ${S}`],
  ]) assert.equal(P.oscura(frase), atteso, frase);
});

test('anche con un complemento, le virgolette, il CVV, il codice, due avverbi o il tempo composto', () => {
  for (const [frase, atteso] of [
    ['il pin del telefono è ancora 4821', `il pin del telefono è ancora ${S}`],
    ['il pin è sempre stato 4821', `il pin è sempre stato ${S}`],
    ['il pin è già 4821', `il pin è già ${S}`],
    ['the pin is now 4821', `the pin is now ${S}`],
    ['la password è di nuovo casa1234', `la password è di nuovo ${S}`],
    ['la password è ancora «casa1234»', `la password è ancora «${S}»`],
    ['the password is still hunter22', `the password is still ${S}`],
    ['il cvv è sempre 739', `il cvv è sempre ${S}`],
    ['il codice otp è ancora 482913', `il codice otp è ancora ${S}`],
    ['il codice del cancello è ancora 4829', `il codice del cancello è ancora ${S}`],
    ['Der PIN ist noch 4821', `Der PIN ist noch ${S}`],
    ['El PIN es todavía 4821', `El PIN es todavía ${S}`],
    ['le code PIN est toujours 4821', `le code PIN est toujours ${S}`],
    ['Password: casa è ancora mia', `Password: ${S}`],
  ]) assert.equal(P.oscura(frase), atteso, frase);
});

test('una frase che dice com\'è il PIN o la password, senza il valore, resta com\'è', () => {
  for (const frase of [
    'il pin è ancora sbagliato',
    'il pin è sempre lo stesso',
    'il pin è ora cambiato 2 volte',
    'la password è ancora valida',
    'Codice abbonamento è ancora 4829',
    'il pin è ancora quello del 2019',
  ]) assert.equal(P.oscura(frase), frase, frase);
});

test('in uscita il valore dopo l\'avverbio si riconosce da solo', () => {
  const valori = (t) => G.segretiInUscita(t).map((x) => x.valore);
  for (const [frase, v] of [
    ['il pin è ora 4821', '4821'], ['the pin is still 4821', '4821'], ['El PIN es todavía 4821', '4821'],
    ['la password è ancora casa1234', 'casa1234'], ['the password is still hunter22', 'hunter22'],
    ['il%20pin%20%C3%A8%20ora%204821', '4821'],
  ]) assert.ok(valori(frase).includes(v), frase);
  assert.deepEqual(valori('il pin è ancora sbagliato'), []);
});

test('nel correttore la parola dopo «la pass è ancora» conta come dopo «la pass è»', () => {
  assert.deepEqual(R.trova('la pass è ancora gattonero'), R.trova('la pass è gattonero'));
  assert.deepEqual(R.trova('la pass è ancora gattonero'), ['gattonero']);
});

test('gli avverbi letti come spazi lasciano il testo lungo uguale', () => {
  const t = 'Ciao! il pin è sempre stato 4821, la password è attualmente casa1234';
  const letto = G.avverbiComeSpazi(t);
  assert.equal(letto.length, t.length);
  assert.equal(letto.replace(/ +/g, ' '), 'Ciao! il pin è 4821, la password è casa1234');
  assert.equal(G.avverbiComeSpazi('ancora 4821'), 'ancora 4821');
});

test('l\'elenco degli avverbi sta nel guardiano: pavimento e correttore non ne tengono uno loro', () => {
  for (const f of ['pavimento.js', 'riservatiNelTesto.js']) {
    const src = readFileSync(join(ROOT, 'src', 'shared', f), 'utf8');
    assert.ok(!/maintenant|todav|wci[ąa]|altijd/.test(src), `${f}: gli avverbi stanno in guardianoStatico.js (AVVERBI)`);
  }
});
