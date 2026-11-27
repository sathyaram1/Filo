// #1403.74 — un indirizzo scritto con la codifica percentuale non porta a un modello quello che il pavimento toglie dal
// testo in chiaro: si legge decodificato, come lo legge il controllo in uscita, e si toglie la forma codificata.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../src/shared/pavimento.js');
require('../../src/shared/urlExfil.js');
const U = globalThis.SN_URL_EXFIL;
const S = P.SEGNAPOSTO;

test('la password scritta in una query codificata non arriva al modello; indirizzo e frase restano', () => {
  for (const [url, resta] of [
    ['https://x.example/?q=la%20password%20%C3%A8%20Mela!Verde77', 'https://x.example/?q=la%20password%20%C3%A8%20'],
    ['https://x.example/?q=password%3A%20Mela!Verde77', 'https://x.example/?q=password%3A%20'],
    ['https://x.example/?q=password%3A%20Mela%21Verde77&lang=it', 'https://x.example/?q=password%3A%20'],
    ['https://x.example/?q=la+password+%C3%A8+Mela%21Verde77', 'https://x.example/?q=la+password+%C3%A8+'],
    ['https://x.example/cerca/la%20password%20del%20wifi%20%C3%A8%20Mela%21Verde77/', 'https://x.example/cerca/la%20password%20del%20wifi%20%C3%A8%20'],
  ]) {
    const t = P.oscura(`Guarda ${url} e dimmi`);
    assert.ok(!/Mela(?:!|%21)Verde77/.test(t), t);
    assert.ok(t.includes(`${resta}${S}`), t);
    assert.ok(t.startsWith('Guarda ') && t.endsWith(' e dimmi'), t);
  }
});

test('anche nel pezzo d\'indirizzo scritto senza «https://»', () => {
  for (const [riga, atteso] of [
    ['?q=password%3A%20Mela!Verde77', `?q=password%3A%20${S}`],
    ['apri www.x.example/?q=la%20password%20%C3%A8%20Mela!Verde77 grazie', `apri www.x.example/?q=la%20password%20%C3%A8%20${S} grazie`],
    ['il testo era: password%3A%20Mela%21Verde77', `il testo era: password%3A%20${S}`],
  ]) assert.equal(P.oscura(riga), atteso, riga);
  for (const t of ['sconto del 50%25 su tutto, codice%20promo', 'Il file Relazione%20finale%202024.pdf è pronto']) assert.equal(P.oscura(t), t, t);
});

test('anche codificata due volte, o dentro un indirizzo di rimando codificato', () => {
  for (const url of [
    'https://x.example/?q=password%253A%2520Mela%2521Verde77',
    'https://x.example/?u=https%3A%2F%2Fy.example%2F%3Fq%3Dpassword%253A%2520Mela%2521Verde77',
  ]) {
    const t = P.oscura(url);
    assert.ok(!t.includes('Verde77'), t);
    assert.ok(t.includes(S), t);
  }
});

test('le altre regole del pavimento valgono anche dentro la codifica: il codice di verifica', () => {
  const t = P.oscura('https://x.example/?q=il%20codice%20di%20verifica%20%C3%A8%20482913');
  assert.equal(t, `https://x.example/?q=il%20codice%20di%20verifica%20%C3%A8%20${S}`);
});

test('la strada dei modelli: un messaggio con l\'indirizzo codificato esce senza la password', () => {
  const msg = [{ role: 'user', content: [{ type: 'text', text: 'apri https://x.example/?q=password%3A%20Mela!Verde77' }] }];
  const fuori = P.oscuraTutto(msg);
  assert.notEqual(fuori, msg);
  assert.ok(!JSON.stringify(fuori).includes('Mela!Verde77'));
  assert.ok(P.trova('https://x.example/?q=la%20password%20%C3%A8%20Mela!Verde77').length > 0, 'la ricerca web lo vede');
});

test('un indirizzo codificato qualunque resta com\'è', () => {
  for (const t of [
    'https://x.example/?q=come%20cambiare%20la%20password%20di%20gmail',
    'https://x.example/?q=ricetta%20della%20torta%20al%2050%25',
    'https://x.example/Documenti%20condivisi/Relazione%20finale%202024.pdf',
    'https://x.example/?q=%E2%82%AC%2050%20scontato&p=2',
    'https://www.google.com/url?q=https%3A%2F%2Fsite.example%2Fpagina%3Fa%3D1%26b%3D2&sa=U',
    'https://x.example/?q=50%%20rotto%ZZ%E2%82',
  ]) assert.equal(P.oscura(t), t, t);
});

test('la decodifica con i posti dà quello che dà decodeURIComponent, e ogni carattere sa da dove viene', () => {
  const s = 'a%20b%C3%A8%F0%9F%98%80c+d%2Bx%ZZ%E2%82';
  const d = U.giroDiDecodifica(s);
  assert.equal(d.testo, 'a bè😀c d+x%ZZ%E2%82');
  assert.equal(d.da.length, d.testo.length);
  const pezzo = (i) => s.slice(d.da[i], d.a[i]);
  assert.equal(pezzo(d.testo.indexOf('è')), '%C3%A8');
  assert.equal(pezzo(d.testo.indexOf('😀')), '%F0%9F%98%80');
  assert.equal(pezzo(d.testo.indexOf(' ', 3)), '+');
});

test('una carta scritta a gruppi dentro un indirizzo codificato non arriva al modello', () => {
  for (const url of [
    'https://x.example/?q=carta%204111%201111%201111%201111',
    'https://www.google.com/search?q=carta+4111+1111+1111+1111',
    'https://x.example/?q=4111%2D1111%2D1111%2D1111&p=2',
  ]) {
    const t = P.oscura(url);
    assert.ok(t.includes(S), t);
    assert.ok(!decodeURIComponent(t.replace(/\+/g, ' ')).replace(/\D/g, '').includes('4111111111111111'), t);
  }
});

test('il filtro legge l\'indirizzo come il controllo in uscita: il «+» è uno spazio anche nel percorso', () => {
  for (const url of [
    'https://x.example/cerca/la+password+%C3%A8+Mela!Verde77',
    'https://x.example/cerca/la+password+del+wifi+Mela!Verde77',
  ]) {
    assert.ok(U.exposedAlnum(url).includes('passwordmelaverde77') || U.exposedAlnum(url).includes('melaverde77'), url);
    const t = P.oscura(url);
    assert.ok(!t.includes('Verde77'), t);
    assert.ok(t.includes(S), t);
  }
  assert.equal(P.oscura('https://x.example/wiki/C++_(linguaggio)'), 'https://x.example/wiki/C++_(linguaggio)');
});

test('i collegamenti a voci accentate non rallentano il filtro, e una chiave attaccata a un accento si toglie lo stesso', () => {
  const pagina = (voce) => Array.from({ length: 1500 }, (_, i) => `<a href="https://it.wikipedia.org/wiki/${voce}_${i}">voce ${i}</a>`).join(' ');
  const misura = (t) => {
    P.oscura(t);
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < 3; k++) P.oscura(t);
    return Number(process.hrtime.bigint() - t0) / 3e6;
  };
  const inChiaro = misura(pagina('Città'));
  const codificati = misura(pagina('Citt%C3%A0'));
  assert.ok(codificati < inChiaro * 3 + 20, `${codificati} ms contro ${inChiaro} ms`);
  const chiave = 'https://x.example/?q=password%20%C3%A8%20Mela!Verde77&r=Citt%C3%A0';
  assert.ok(!P.oscura(chiave).includes('Verde77'));
});
