// #2714 — un PIN, un codice o una password detti da un verbo di cambio («diventa», «ho cambiato … in …») o dopo la
// domanda («ti ricordi la password? Era …») non arrivano ai modelli né escono verso un sito, come dopo «è».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const G = globalThis.SN_GUARDIANO_STATICO;
const P = globalThis.SN_PAVIMENTO;
const C = require(join(ROOT, 'src', 'main', 'services', 'correttoreRiservati.js'));
const S = P.SEGNAPOSTO;
const valori = (xs) => xs.map((x) => String(x.valore));

test('il PIN e il codice del cancello detti col verbo di cambio arrivano al modello col segnaposto', () => {
  for (const [t, atteso] of [
    ['ho cambiato il pin in 4821', `ho cambiato il pin in ${S}`],
    ['il pin è diventato 4821', `il pin è diventato ${S}`],
    ['il pin diventa «4821»', `il pin diventa «${S}»`],
    ['ho cambiato il codice del cancello in 4821', `ho cambiato il codice del cancello in ${S}`],
    ['il codice del cancello è diventato 4821', `il codice del cancello è diventato ${S}`],
    ['il codice del cancello diventa 4821', `il codice del cancello diventa ${S}`],
    ['ho cambiato il PIN della carta in 4821', `ho cambiato il PIN della carta in ${S}`],
    ['ho impostato il pin a 4821', `ho impostato il pin a ${S}`],
    ['il pin è stato cambiato in 4821', `il pin è stato cambiato in ${S}`],
    ['il pin resta 4821', `il pin resta ${S}`],
    ['I changed my PIN to 4821', `I changed my PIN to ${S}`],
    ['I changed the gate code to 4821', `I changed the gate code to ${S}`],
    ['the pin for my phone was changed to 4821', `the pin for my phone was changed to ${S}`],
  ]) {
    assert.equal(P.oscura(t), atteso, `pavimento: ${t}`);
    assert.equal(C.oscura(t), atteso, `correttore: ${t}`);
  }
  const messaggi = [{ role: 'user', content: [{ type: 'text', text: 'Ciao! ho cambiato il codice del cancello in 4821, segnatelo' }] }];
  assert.doesNotMatch(JSON.stringify(P.oscuraTutto(messaggi)), /4821/);
});

test('un identificativo o un numero che non è il valore resta, anche col verbo di cambio', () => {
  for (const t of [
    'ho cambiato il codice del corso in 4829',
    'ho cambiato il codice sconto in 2024',
    'I changed the course code to 4829',
    'ho cambiato il pin in banca',
    'ho cambiato il pin in 4 cifre',
    'ho cambiato la porta in 3000',
    'il pin della carta resta segreto, la pagina è 2048',
    'ho cambiato idea, il pin a 4821 lo tengo',
  ]) assert.equal(P.oscura(t), t, t);
});

test('la password detta col verbo di cambio o dopo la domanda è un segreto letto e un segreto in uscita', () => {
  for (const t of [
    'ho cambiato la password in Mela!Verde77',
    'la password diventa Mela!Verde77',
    'Ti ricordi la password? Era Mela!Verde77',
    'la password è stata cambiata in Mela!Verde77',
    'la password è diventata Mela!Verde77',
    'I changed the password to Mela!Verde77',
    'the password became Mela!Verde77',
  ]) {
    assert.deepEqual(valori(G.segretiNelTesto(t)), ['Mela!Verde77'], `letto: ${t}`);
    assert.ok(valori(G.segretiInUscita(t)).includes('Mela!Verde77'), `in uscita: ${t}`);
  }
  for (const t of ['ho cambiato la password in ufficio', 'la password diventa obbligatoria', 'manda la password a Luca2024',
    'Ti ricordi la password? Era scritta sul foglio']) {
    assert.deepEqual(valori(G.segretiNelTesto(t)), [], t);
  }
});

test('il PIN detto col verbo di cambio esce verso un sito solo con la conferma', () => {
  for (const t of ['ho cambiato il pin in 4821', 'il pin è diventato 4821', 'il pin diventa «4821»', 'il pin resta 4821',
    'ho cambiato il PIN della carta in 4821', 'the pin for my phone was changed to 4821']) {
    assert.ok(valori(G.segretiInUscita(t)).includes('4821'), t);
  }
  assert.deepEqual(valori(G.segretiInUscita('ho cambiato il pin in banca')), []);
});

test('la password con lo spazio dopo il punto esclamativo arriva al modello tutta col segnaposto', () => {
  for (const [t, atteso] of [
    ['la password è Mela! Verde77', `la password è ${S}`],
    ['la password è Mela! Verde77 ok?', `la password è ${S} ok?`],
    ['la password è Mela! Verde77, segnatela', `la password è ${S}, segnatela`],
  ]) {
    assert.equal(P.oscura(t), atteso, `pavimento: ${t}`);
    assert.equal(C.oscura(t), atteso, `correttore: ${t}`);
  }
  // La parola dopo senza la forma di una password è il resto della frase.
  assert.equal(P.oscura('la password è Mela! ricordatela'), `la password è ${S} ricordatela`);
  assert.equal(P.oscura('la password è Ciao! Come stai?'), `la password è ${S} Come stai?`);
});

test('la password spezzata da uno spazio non arriva al modello nemmeno a metà, dopo un saluto, un altro simbolo o un cambio', () => {
  for (const t of [
    'Ciao, la password è Mela! Verde77',
    'Ecco: la password è Mela! Verde77',
    'ok. la password è Mela! Verde77',
    'la password è Mela!  Verde77',
    'la password è Mela# Verde77',
    'la password è Mela$ Verde77',
    'la password diventa Mela! Verde77',
    'la password è diventata Mela! Verde77',
    'Ti ricordi la password? Era Mela! Verde77',
  ]) {
    for (const [nome, verso] of [['pavimento', P.oscura(t)], ['correttore', C.oscura(t)]]) {
      for (const pezzo of ['Mela', 'Verde77']) assert.ok(!verso.includes(pezzo), `${nome}: ${t} → ${verso}`);
    }
  }
  const verso = C.oscura('la password è diventata «Mela Verde 77»');
  for (const pezzo of ['Mela', 'Verde', '77']) assert.ok(!verso.includes(pezzo), verso);
  // La prima parola che dice com'è la password non si attacca alla dopo.
  assert.equal(P.oscura('la password è sbagliata! Riprova2 tra poco').includes('Riprova2'), true);
});

test('il valore detto dopo il cambio con «ora», in una frase a parte o col pronome', () => {
  for (const t of ['ho cambiato il pin, ora è 4821', 'ho cambiato il pin. Adesso è 4821', 'il pin è ora 4821', 'my pin is now 4821',
    'I changed my pin, now it is 4821', 'il pin adesso diventa 4821', 'ho cambiato il pin ed è diventato 4821',
    "il pin l'ho cambiato, ora è 4821", 'ho cambiato il pin, il nuovo è 4821']) {
    assert.ok(!P.oscura(t).includes('4821'), `pavimento: ${t}`);
    assert.ok(valori(G.segretiInUscita(t)).includes('4821'), `in uscita: ${t}`);
  }
  for (const t of ["la password l'ho cambiata in Mela!Verde77", 'la password adesso è Mela!Verde77',
    'la password è ora Mela!Verde77', 'the password is now Mela!Verde77']) {
    assert.ok(valori(G.segretiInUscita(t)).includes('Mela!Verde77'), `in uscita: ${t}`);
  }
  for (const t of ['ho aggiornato il pin, ora è più sicuro', 'la password ora è obbligatoria', 'ho cambiato il pin. La pagina è 2048',
    'I changed my password, now it is safer']) {
    assert.equal(P.oscura(t), t, t);
    assert.deepEqual(valori(G.segretiInUscita(t)), [], t);
  }
});

test('dopo il PIN o un codice, un numero di un\'altra frase o un anno restano', () => {
  for (const t of ['il pin non funziona e il prezzo diventa 4821', 'se sbagli il pin, la multa diventa 2000',
    'il codice del cancello è rotto, il preventivo diventa 4821', 'il pin è giusto e la pagina diventa 2048',
    'I changed my PIN in 2024', 'the pin was set in 2023']) {
    assert.equal(P.oscura(t), t, t);
    assert.deepEqual(valori(G.segretiInUscita(t)), [], t);
  }
});
