// #2294 — più file scaricati da una pagina senza un clic: come in Chrome il primo passa, dal secondo vicino si chiede nella
// cornice, e la risposta resta per il sito. Logica di src/main/services/permessiPagine.js; il cammino vero (file nella
// cartella Download, domanda, Consenti e Blocca) sta in tests/download-piu-file-2294.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../src/main/services/permessiPagine.js');

const ADESSO = Date.parse('2026-11-08T02:00:00Z');

function sessione() {
  const ses = { avvisi: [] };
  ses.setPermissionRequestHandler = () => {};
  ses.setPermissionCheckHandler = () => {};
  P.installa(ses, { schedaDi: () => ({ tabId: 't1', avvisa: (evento, dati) => ses.avvisi.push({ evento, dati }) }) });
  return ses;
}
function pagina(ses, url) {
  const ascolti = {};
  return {
    session: ses,
    getURL: () => url,
    isDestroyed: () => false,
    on: (ev, fn) => { (ascolti[ev] ||= []).push(fn); },
    once: (ev, fn) => { (ascolti[ev] ||= []).push(fn); },
    emetti: (ev, ...a) => { for (const fn of ascolti[ev] || []) fn(...a); },
  };
}
const esito = (wc, gesto, t) => P.scaricamentoSenzaGesto(wc, gesto, t).esito;

test('il primo file senza clic passa, il secondo entro dieci minuti chiede; dopo dieci minuti si riparte da capo', () => {
  const wc = pagina(sessione(), 'https://scarica.example/pagina');
  assert.equal(esito(wc, false, ADESSO), 'via');
  assert.equal(esito(wc, false, ADESSO + 1000), 'chiedi');
  assert.equal(esito(wc, false, ADESSO + 2000), 'chiedi');
  assert.equal(esito(wc, false, ADESSO + 2000 + P.SCARICAMENTI_FINESTRA_MS), 'via');
});

test('un clic dell\'utente passa sempre e azzera il conto; le pagine di Filo e i download senza pagina non contano', () => {
  const ses = sessione();
  const wc = pagina(ses, 'https://galleria.example/');
  assert.equal(esito(wc, false, ADESSO), 'via');
  assert.equal(esito(wc, true, ADESSO + 500), 'via');
  assert.equal(esito(wc, false, ADESSO + 1000), 'via', 'dopo il clic il primo senza clic è di nuovo il primo');
  const filo = pagina(ses, 'filo://downloads/downloads.html');
  for (let i = 0; i < 3; i++) assert.equal(esito(filo, false, ADESSO + i), 'via');
  for (let i = 0; i < 3; i++) assert.equal(esito(null, false, ADESSO + i), 'via', 'Riprova parte dalla sessione, senza pagina');
  // Due siti hanno ognuno il suo primo.
  const altro = pagina(ses, 'https://altro.example/');
  assert.equal(esito(altro, false, ADESSO + 1500), 'via');
});

test('la domanda sta nella cornice col sito; Consenti vale per il sito, e le domande ritirate non sono una scelta', () => {
  const ses = sessione();
  const wc = pagina(ses, 'https://scarica.example/pagina');
  const risposte = [];
  P.chiediScaricamenti(wc, (si, _f, decisa) => risposte.push([si, decisa]));
  P.chiediScaricamenti(wc, (si, _f, decisa) => risposte.push([si, decisa]));
  const domande = ses.avvisi.filter((a) => a.evento === 'chiedi');
  assert.equal(domande.length, 1, 'più file della stessa pagina fanno una domanda sola');
  assert.equal(domande[0].dati.tipo, 'scaricamenti');
  assert.equal(domande[0].dati.dominio, 'scarica.example');
  P.rispondi(domande[0].dati.id, true);
  assert.deepEqual(risposte, [[true, true], [true, true]]);
  assert.equal(esito(wc, false, ADESSO), 'via');
  assert.equal(esito(wc, false, ADESSO + 1), 'via', 'col sì il sito non chiede più');

  // La pagina se ne va prima della risposta: chi aspettava sa che nessuno ha scelto.
  const via = pagina(ses, 'https://altrove.example/');
  const ritirate = [];
  P.chiediScaricamenti(via, (si, _f, decisa) => ritirate.push([si, decisa]));
  via.emetti('destroyed');
  assert.deepEqual(ritirate, [[false, false]]);
});

test('Blocca vale per il sito: i file dopo si fermano senza domanda e la scheda ne porta il segno; la chat lo toglie', () => {
  const ses = sessione();
  const wc = pagina(ses, 'https://spam.example/');
  const risposte = [];
  P.chiediScaricamenti(wc, (si, _f, decisa) => risposte.push([si, decisa]));
  const d = ses.avvisi.find((a) => a.evento === 'chiedi');
  P.rispondi(d.dati.id, false);
  assert.deepEqual(risposte, [[false, true]]);
  assert.equal(esito(wc, false, ADESSO), 'no');
  assert.deepEqual(P.segniDi(wc).negati, ['scaricamenti']);
  assert.equal(esito(wc, true, ADESSO + 1), 'via', 'un clic dell\'utente scarica lo stesso');
  const subito = [];
  P.chiediScaricamenti(wc, (si, _f, decisa) => subito.push([si, decisa]));
  assert.deepEqual(subito, [[false, true]], 'con la risposta data non si richiede');
  assert.equal(P.dimentica(wc).tolte, 1, 'il menu della scheda la toglie come gli altri permessi');
  assert.equal(esito(wc, false, ADESSO + 2), 'via');
});
