// #871 — la cronologia di una scheda sopravvive alla vista ricreata: sito → Home → Indietro torna al sito.
// La regola pura; che la barra ci arrivi davvero lo prova tests/barra-laterale.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Storia = require('../../src/main/tabs/storia.js');

const v = (url) => ({ url, titolo: url });
const urls = (lista) => lista.map((x) => x.url);

test('una navigazione nuova fuori dalla vista porta dietro le voci fino alla attiva e toglie il davanti', () => {
  const vista = { voci: [v('https://a/1'), v('https://a/2'), v('https://a/3')], attiva: 1 };
  const s = Storia.conserva({ prima: [v('filo://newtab/')], dopo: [v('https://x/')] }, vista, 'nuova', 'filo://newtab/');
  assert.deepEqual(urls(s.prima), ['filo://newtab/', 'https://a/1', 'https://a/2']);
  assert.deepEqual(s.dopo, []);
});

test('la stessa pagina ricreata (proxy, crash) tiene il dietro e il davanti', () => {
  const vista = { voci: [v('https://a/1'), v('https://a/2'), v('https://a/3')], attiva: 1 };
  const s = Storia.conserva(Storia.nuova(), vista, 'stessa', 'https://a/2');
  assert.deepEqual(urls(s.prima), ['https://a/1']);
  assert.deepEqual(urls(s.dopo), ['https://a/3']);
});

test('il ritorno da un salto fermato non lascia la pagina di prima anche dietro', () => {
  const s = Storia.conserva({ prima: [v('https://a/1')], dopo: [] }, { voci: [], attiva: 0 }, 'ritorno', 'https://a/1');
  assert.deepEqual(s.prima, []);
});

test('Indietro fuori dalla vista: la vista intera passa davanti; Avanti la riporta', () => {
  const s0 = { prima: [v('https://a/1'), v('https://a/2')], dopo: [] };
  const vistaHome = [v('filo://newtab/')];
  const indietro = Storia.salta(s0, vistaHome, 'indietro', 0);
  assert.equal(indietro.meta.url, 'https://a/2');
  assert.deepEqual(urls(indietro.storia.prima), ['https://a/1']);
  assert.deepEqual(urls(indietro.storia.dopo), ['filo://newtab/']);
  const avanti = Storia.salta(indietro.storia, [v('https://a/2')], 'avanti', 0);
  assert.equal(avanti.meta.url, 'filo://newtab/');
  assert.deepEqual(urls(avanti.storia.prima), ['https://a/1', 'https://a/2']);
  assert.deepEqual(avanti.storia.dopo, []);
  assert.equal(Storia.salta(avanti.storia, [], 'avanti', 0), null);
});

test('un salto lontano dall\'elenco del tasto destro tiene l\'ordine delle pagine', () => {
  const s0 = { prima: [v('p1'), v('p2'), v('p3')], dopo: [v('d1')] };
  const r = Storia.salta(s0, [v('vista')], 'indietro', 2);
  assert.equal(r.meta.url, 'p1');
  assert.deepEqual(urls(r.storia.dopo), ['p2', 'p3', 'vista', 'd1']);
  const el = Storia.elenco(s0, 'indietro', 4);
  assert.deepEqual(el.map((x) => [x.indice, x.url]), [[-1, 'p3'], [-2, 'p2'], [-3, 'p1']]);
  assert.deepEqual(Storia.fuori(-3, 4), { verso: 'indietro', k: 2 });
  assert.deepEqual(Storia.elenco(s0, 'avanti', 4).map((x) => x.indice), [4]);
  assert.deepEqual(Storia.fuori(4, 4), { verso: 'avanti', k: 0 });
  assert.equal(Storia.fuori(2, 4), null);
});

test('le voci della vista: la pagina d\'errore vale per l\'indirizzo fallito, about:blank e gli schemi non web no', () => {
  const entries = [{ url: 'about:blank' }, { url: 'filo://neterror?u=https://giu' }, { url: 'https://a/', title: 'A' }, { url: 'javascript:alert(1)' }];
  const utente = (u) => (u.startsWith('filo://neterror') ? 'https://giu' : u);
  const r = Storia.vociDellaVista(entries, 2, utente);
  assert.deepEqual(urls(r.voci), ['https://giu', 'https://a/']);
  assert.equal(r.attiva, 1);
});

test('una pagina nuova nella vista toglie il davanti; un passo chiesto da Filo o indietro no', () => {
  assert.equal(Storia.paginaNuova({ n: 1, a: 0 }, { n: 2, a: 1 }, false), true);
  assert.equal(Storia.paginaNuova({ n: 3, a: 0 }, { n: 2, a: 1 }, false), true);
  assert.equal(Storia.paginaNuova({ n: 2, a: 0 }, { n: 2, a: 1 }, true), false);
  assert.equal(Storia.paginaNuova({ n: 2, a: 1 }, { n: 2, a: 0 }, false), false);
  assert.equal(Storia.paginaNuova({ n: 2, a: 1 }, { n: 2, a: 1 }, false), false);
  assert.equal(Storia.paginaNuova(null, { n: 1, a: 0 }, false), false);
});

test('una vista appena nata conta già la pagina che sta caricando: due Indietro di fila non la perdono', () => {
  const s0 = { prima: [v('https://a/1'), v('https://a/2')], dopo: [] };
  const primo = Storia.salta(s0, [v('filo://newtab/')], 'indietro', 0);
  const vistaInCarico = Storia.vociDellaVista([], 0, (u) => u, { url: primo.meta.url, titolo: 'A2' });
  assert.deepEqual(urls(vistaInCarico.voci), ['https://a/2']);
  const secondo = Storia.salta(primo.storia, vistaInCarico.voci, 'indietro', 0);
  assert.equal(secondo.meta.url, 'https://a/1');
  assert.deepEqual(urls(secondo.storia.dopo), ['https://a/2', 'filo://newtab/']);
  // Committata la pagina, contano le voci vere.
  assert.deepEqual(urls(Storia.vociDellaVista([{ url: 'https://a/3' }], 0, (u) => u, { url: 'https://a/2' }).voci), ['https://a/3']);
});
