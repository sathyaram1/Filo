// Permessi delle pagine web (#591.1): microfono, fotocamera, appunti e posizione passano da un sì dell'utente;
// Filo stesso e i suoi lasciapassare no; la finestra nascosta del controllo profondo dice no a tutto.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Permessi = require('../../src/main/services/permessiPagine.js');

let prossimoId = 1;
function wcFinto(url) {
  const ascolti = {};
  return {
    id: prossimoId++,
    getURL: () => url,
    isDestroyed: () => false,
    on: (ev, fn) => { (ascolti[ev] ||= []).push(fn); },
    once: (ev, fn) => { (ascolti[ev] ||= []).push(fn); },
    emetti: (ev, ...a) => { for (const fn of ascolti[ev] || []) fn(...a); },
  };
}

function sessioneFinta({ conScheda = true } = {}) {
  const ses = { avvisi: [] };
  ses.setPermissionRequestHandler = (fn) => { ses.richiesta = fn; };
  ses.setPermissionCheckHandler = (fn) => { ses.controllo = fn; };
  Permessi.installa(ses, {
    schedaDi: () => (conScheda ? { tabId: 't1', avvisa: (evento, dati) => ses.avvisi.push({ evento, dati }) } : null),
  });
  return ses;
}

function chiedi(ses, wc, permission, details = {}) {
  const esiti = [];
  ses.richiesta(wc, permission, (si) => esiti.push(si), details);
  return esiti;
}

test('una pagina web che chiede microfono e fotocamera aspetta la risposta dell\'utente, e il sì vale per le volte dopo', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://riunione.example/stanza');
  const prima = chiedi(ses, wc, 'media', { mediaTypes: ['audio', 'video'] });
  assert.deepEqual(prima, [], 'nessuna risposta prima che l\'utente scelga');
  const domanda = ses.avvisi.find((a) => a.evento === 'chiedi');
  assert.equal(domanda.dati.host, 'riunione.example');
  assert.deepEqual(domanda.dati.parti, ['audio', 'video']);
  assert.equal(Permessi.rispondi(domanda.dati.id, true), true);
  assert.deepEqual(prima, [true]);
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: ['audio'] }), [true], 'già concesso: niente seconda domanda');
  assert.equal(ses.avvisi.filter((a) => a.evento === 'chiedi').length, 1);
});

test('il no dell\'utente vale per le volte dopo, e il controllo lo dice al sito', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://spia.example/');
  const esiti = chiedi(ses, wc, 'clipboard-read');
  const domanda = ses.avvisi.find((a) => a.evento === 'chiedi');
  assert.equal(domanda.dati.tipo, 'appunti');
  Permessi.rispondi(domanda.dati.id, false);
  assert.deepEqual(esiti, [false]);
  assert.deepEqual(chiedi(ses, wc, 'clipboard-read'), [false]);
  assert.equal(ses.controllo(wc, 'clipboard-read', 'https://spia.example', {}), false);
});

test('la lettura sincrona degli appunti non sa chiedere: vale no finché l\'utente non ha detto sì', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://spia.example/');
  assert.equal(ses.controllo(wc, 'deprecated-sync-clipboard-read', 'https://spia.example', {}), false);
  const esiti = chiedi(ses, wc, 'clipboard-read');
  Permessi.rispondi(ses.avvisi.find((a) => a.evento === 'chiedi').dati.id, true);
  assert.deepEqual(esiti, [true]);
  assert.equal(ses.controllo(wc, 'deprecated-sync-clipboard-read', 'https://spia.example', {}), true);
});

test('Filo stesso non si chiede niente: pagine filo:// e la cornice', () => {
  const ses = sessioneFinta();
  assert.deepEqual(chiedi(ses, wcFinto('filo://newtab/'), 'media', { mediaTypes: ['audio'] }), [true]);
  assert.deepEqual(chiedi(ses, wcFinto('filo://shell/shell.html'), 'clipboard-read'), [true]);
  assert.equal(ses.avvisi.length, 0);
});

test('Detta e Incolla di Filo sulla pagina passano col lasciapassare, per pochi secondi e solo per quello chiesto', () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  try {
    const ses = sessioneFinta();
    const wc = wcFinto('https://posta.example/');
    assert.equal(Permessi.lasciapassare(wc, 'media'), true);
    assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: ['audio'] }), [true]);
    assert.deepEqual(chiedi(ses, wc, 'clipboard-read'), [], 'il lasciapassare del microfono non apre gli appunti');
    mock.timers.tick(6000);
    assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: ['audio'] }), [], 'scaduto: si torna a chiedere');
    assert.equal(Permessi.lasciapassare(wc, 'posizione'), false, 'la posizione non ha lasciapassare');
  } finally {
    mock.timers.reset();
  }
});

test('una pagina che non sta in una scheda (nessuno a cui chiedere) riceve no', () => {
  const ses = sessioneFinta({ conScheda: false });
  assert.deepEqual(chiedi(ses, wcFinto('https://accesso.example/'), 'geolocation'), [false]);
});

test('una domanda senza risposta vale no dopo un po\', non viene ricordata e si ritira dalla cornice', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const ses = sessioneFinta();
    const wc = wcFinto('https://mappa.example/');
    const esiti = chiedi(ses, wc, 'geolocation');
    mock.timers.tick(Permessi.ATTESA_MS + 1);
    assert.deepEqual(esiti, [false]);
    assert.ok(ses.avvisi.some((a) => a.evento === 'fine'));
    assert.deepEqual(chiedi(ses, wc, 'geolocation'), [], 'si può chiedere di nuovo');
  } finally {
    mock.timers.reset();
  }
});

test('la pagina che se ne va ritira la sua domanda; due richieste uguali fanno una domanda sola', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://riunione.example/');
  const a = chiedi(ses, wc, 'media', { mediaTypes: ['video'] });
  const b = chiedi(ses, wc, 'media', { mediaTypes: ['video'] });
  assert.equal(ses.avvisi.filter((x) => x.evento === 'chiedi').length, 1);
  wc.emetti('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.deepEqual([a, b], [[false], [false]]);
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: ['video'] }), [], 'non ricordato: si richiede');
});

test('la finestra nascosta del controllo profondo dice no a tutto, anche al controllo', () => {
  const ses = {};
  ses.setPermissionRequestHandler = (fn) => { ses.richiesta = fn; };
  ses.setPermissionCheckHandler = (fn) => { ses.controllo = fn; };
  Permessi.negaTutto(ses);
  for (const p of ['media', 'clipboard-read', 'geolocation', 'notifications', 'fullscreen']) {
    assert.deepEqual(chiedi(ses, wcFinto('https://sospetto.example/'), p), [false], p);
    assert.equal(ses.controllo(null, p, 'https://sospetto.example', {}), false, p);
  }
});

test('i permessi fuori dall\'elenco restano come prima, e il gestore dello schermo pieno parla per primo', () => {
  const ses = { setPermissionCheckHandler() {} };
  ses.setPermissionRequestHandler = (fn) => { ses.richiesta = fn; };
  Permessi.installa(ses, { prima: (_wc, p, cb) => { if (p === 'fullscreen') { cb(false); return true; } return false; } });
  assert.deepEqual(chiedi(ses, wcFinto('https://video.example/'), 'fullscreen'), [false]);
  assert.deepEqual(chiedi(ses, wcFinto('https://video.example/'), 'notifications'), [true]);
});
