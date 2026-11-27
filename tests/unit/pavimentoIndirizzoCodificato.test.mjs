// #1403.74 — un indirizzo scritto con la codifica percentuale non porta a un modello quello che il pavimento toglie dal
// testo in chiaro: si legge decodificato, come lo legge il controllo in uscita, e si toglie la forma codificata.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../src/shared/pavimento.js');
const U = require('../../src/shared/urlExfil.js');
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
  const d = U.decodificaConPosti(s, { piu: true });
  assert.equal(d.testo, 'a bè😀c d+x%ZZ%E2%82');
  assert.equal(d.da.length, d.testo.length);
  const pezzo = (i) => s.slice(d.da[i], d.a[i]);
  assert.equal(pezzo(d.testo.indexOf('è')), '%C3%A8');
  assert.equal(pezzo(d.testo.indexOf('😀')), '%F0%9F%98%80');
  assert.equal(pezzo(d.testo.indexOf(' ', 3)), '+');
  assert.equal(U.decodificaConPosti('c+d').testo, 'c+d', 'il «+» è uno spazio solo se chiesto');
});
