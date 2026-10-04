// Mittenti e siti fidati (#534): la classe di una fonte si decide dall'indirizzo, mai dal nome mostrato;
// ciò che l'utente toglie resta tolto; un sito di molti autori si sconsiglia senza vietarlo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/nomiSito.js');
require('../../src/shared/fiducia.js');
const F = globalThis.SN_FIDUCIA;

test('un indirizzo si riconosce anche dentro un nome o un mailto, e si scrive minuscolo', () => {
  assert.equal(F.indirizzo('Marco Bianchi <Marco.Bianchi@Uni.it>'), 'marco.bianchi@uni.it');
  assert.equal(F.indirizzo('mailto:luca@example.com'), 'luca@example.com');
  assert.equal(F.indirizzo('  anna@posta.example.org. '), 'anna@posta.example.org');
  for (const no of ['', 'Marco', 'marco@', '@uni.it', 'marco@uni', '<script>@x.it', null, 42]) assert.equal(F.indirizzo(no), '', String(no));
});

test('un sito si riduce all\'host, senza www né porta, e rifiuta ciò che non è un dominio', () => {
  assert.equal(F.sito('https://www.BancaEsempio.it/login?x=1'), 'bancaesempio.it');
  assert.equal(F.sito('www.bancaesempio.it'), 'bancaesempio.it');
  assert.equal(F.sito('bancaesempio.it:8443/area'), 'bancaesempio.it');
  for (const no of ['', 'banca', 'http://', '127.0.0.1', 'javascript:alert(1)']) assert.equal(F.sito(no), '', no);
});

test('la classe di una mail la decide l\'indirizzo del mittente, non il nome', () => {
  let st = F.vuoto();
  st = F.aggiungi(st, { mittente: 'marco@uni.it' }).stato;
  assert.equal(F.fonteMittente(st, 'Marco <marco@uni.it>').classe, 3);
  assert.equal(F.fonteMittente(st, 'marco@uni-it.example').classe, 5);
  assert.equal(F.fonteMittente(st, 'Marco').classe, 5);
  const f = F.fonteMittente(st, 'marco@uni.it');
  assert.deepEqual([f.campo, f.chiave], ['posta', 'posta:marco@uni.it']);
});

test('un sito fidato vale per i suoi sottodomini e per nessun altro', () => {
  const st = F.aggiungi(F.vuoto(), { sito: 'bancaesempio.it' }).stato;
  assert.equal(F.fonteSito(st, 'https://online.bancaesempio.it/conti').classe, 3);
  assert.equal(F.fonteSito(st, 'https://bancaesempio.it.truffa.example/').classe, 5);
  assert.equal(F.fonteSito(st, 'https://altrabancaesempio.it/').classe, 5);
  assert.equal(F.peggiore([{ classe: 3 }, { classe: 5 }, { classe: 2 }]).classe, 5);
});

test('togliere un mittente lo tiene fuori anche quando gli Inviati lo rivedono; rimetterlo a mano lo riporta', () => {
  let st = F.daInviati(F.vuoto(), 'io@gmail.com', ['marco@uni.it', 'io@gmail.com', 'Luca <luca@x.it>'], 1000).stato;
  assert.deepEqual(st.mittenti.map((m) => m.indirizzo), ['marco@uni.it', 'luca@x.it']);
  assert.equal(st.mittenti[0].via, 'inviati');
  st = F.togli(st, { mittente: 'marco@uni.it' }).stato;
  const r = F.daInviati(st, 'io@gmail.com', ['marco@uni.it'], 2000);
  assert.deepEqual(r.nuovi, []);
  assert.equal(F.fidatoMittente(r.stato, 'marco@uni.it'), false);
  st = F.aggiungi(r.stato, { mittente: 'marco@uni.it', via: 'preferenze' }).stato;
  assert.equal(F.fidatoMittente(st, 'marco@uni.it'), true);
  assert.equal(st.tolti.includes('marco@uni.it'), false);
});

test('gli Inviati si rileggono una volta a settimana per account', () => {
  const st = F.daInviati(F.vuoto(), 'io@gmail.com', [], 1000).stato;
  assert.equal(F.inviatiDaRileggere(st, 'io@gmail.com', 2000), false);
  assert.equal(F.inviatiDaRileggere(st, 'io@gmail.com', 1000 + F.RILEGGI_INVIATI_MS + 1), true);
  assert.equal(F.inviatiDaRileggere(st, 'altro@gmail.com', 2000), true);
});

test('un elenco pieno rifiuta col numero invece di tagliare', () => {
  const st = F.vuoto();
  for (let i = 0; i < F.MAX_VOCI; i++) st.mittenti.push({ indirizzo: `p${i}@x.it`, via: 'inviati', dal: 0 });
  const r = F.aggiungi(st, { mittente: 'nuovo@x.it' });
  assert.equal(r.aggiunto, false);
  assert.match(r.errore, new RegExp(String(F.MAX_VOCI)));
});

test('un sito di molti autori si sconsiglia in una frase, uno di un autore solo no', () => {
  assert.match(F.sconsiglio('https://www.reddit.com/r/italy'), /^Te lo sconsiglio: reddit\.com è un sito dove pubblica chiunque/);
  const f = F.sconsiglio('blog.example.it', { commenti: true, autori: 4 });
  assert.match(f, /campo per commentare e mostra 4 autori diversi/);
  assert.equal(f.split('.').filter((x) => x.trim()).length >= 1, true);
  assert.equal(F.sconsiglio('bancaesempio.it', { commenti: false, editor: false, autori: 1 }), '');
});

test('uno stato rovinato si rilegge senza voci false', () => {
  const st = F.normalizza({ mittenti: [{ indirizzo: 'x' }, { indirizzo: 'A@B.it' }, { indirizzo: 'a@b.it' }], siti: 'boh', tolti: [3, 'c@d.it'] });
  assert.deepEqual(st.mittenti.map((m) => m.indirizzo), ['a@b.it']);
  assert.deepEqual(st.siti, []);
  assert.deepEqual(st.tolti, ['c@d.it']);
});
