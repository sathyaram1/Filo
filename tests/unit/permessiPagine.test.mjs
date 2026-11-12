// Permessi delle pagine web (#591.1): microfono, fotocamera, appunti e posizione passano da un sì dell'utente;
// Filo stesso no; lo schermo si sceglie ogni volta; la finestra nascosta del controllo profondo dice no a tutto.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

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

test('Detta e Incolla non aprono niente al sito: nessun lasciapassare, e un no salvato resta no (#586)', () => {
  assert.equal(Permessi.lasciapassare, undefined, 'il microfono di Detta lo apre la cornice, gli appunti di Incolla il main');
  const ses = sessioneFinta();
  const wc = wcFinto('https://posta.example/');
  const esiti = chiedi(ses, wc, 'media', { mediaTypes: ['audio'] });
  Permessi.rispondi(ses.avvisi.find((a) => a.evento === 'chiedi').dati.id, false);
  assert.deepEqual(esiti, [false]);
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: ['audio'] }), [false]);
  const ascolto = readFileSync(new URL('../../src/shared/ascolto.js', import.meta.url), 'utf8');
  assert.match(ascolto, /SN_MICROFONO_CORNICE \? await microfonoDellaCornice/, 'sulle pagine web Detta ascolta dalla cornice');
  const azioni = readFileSync(new URL('../../src/content/actions.js', import.meta.url), 'utf8');
  assert.doesNotMatch(azioni, /navigator\.clipboard\.read/, 'Incolla non legge gli appunti col permesso della pagina');
});

test('una pagina che non sta in una scheda (nessuno a cui chiedere) riceve no', () => {
  const ses = sessioneFinta({ conScheda: false });
  assert.deepEqual(chiedi(ses, wcFinto('https://accesso.example/'), 'geolocation'), [false]);
});

test('una domanda senza risposta resta finché l\'utente risponde: chi risponde con calma concede ancora', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const ses = sessioneFinta();
    const wc = wcFinto('https://mappa.example/');
    const esiti = chiedi(ses, wc, 'geolocation');
    mock.timers.tick(10 * 60_000);
    assert.deepEqual(esiti, [], 'nessuna risposta inventata');
    assert.equal(ses.avvisi.some((a) => a.evento === 'fine'), false, 'la domanda è ancora nella cornice');
    const domanda = ses.avvisi.find((a) => a.evento === 'chiedi');
    Permessi.rispondi(domanda.dati.id, true);
    assert.deepEqual(esiti, [true]);
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

test('quello che Chrome concede passa, quello che chiede si chiede, quello che Filo non sa dare è no; lo schermo pieno ha il suo gestore', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://video.example/');
  const conPrima = { setPermissionCheckHandler() {} };
  conPrima.setPermissionRequestHandler = (fn) => { conPrima.richiesta = fn; };
  Permessi.installa(conPrima, { prima: (_wc, p, cb) => { if (p === 'fullscreen') { cb(false); return true; } return false; } });
  assert.deepEqual(chiedi(conPrima, wc, 'fullscreen'), [false]);
  for (const p of ['clipboard-sanitized-write', 'mediaKeySystem', 'pointerLock', 'screen-wake-lock', 'persistent-storage']) {
    assert.deepEqual(chiedi(ses, wc, p), [true], p);
    assert.equal(ses.controllo(wc, p, 'https://video.example', {}), true, p);
  }
  const tipi = {
    midi: 'strumenti', midiSysex: 'strumenti', 'idle-detection': 'presenza', 'window-management': 'schermi',
    'geolocation-approximate': 'posizione', 'local-network-access': 'rete', 'local-network': 'rete', 'loopback-network': 'rete',
  };
  for (const [p, tipo] of Object.entries(tipi)) {
    assert.deepEqual(chiedi(ses, wc, p), [], p);
    assert.equal(ses.avvisi.at(-1).dati.tipo, tipo, p);
  }
  assert.equal(ses.controllo(wc, 'idle-detection', 'https://video.example', {}), false, 'chi sa che sei al computer lo sa solo col sì');
  for (const p of ['display-capture', 'unknown', 'hid', 'serial', 'usb', 'captured-surface-control', 'smart-card', 'nfc', 'ar', 'vr',
    'hand-tracking', 'web-printing', 'web-app-installation', 'automatic-fullscreen', 'periodic-background-sync', 'system-wake-lock',
    'speaker-selection', 'local-fonts']) {
    assert.deepEqual(chiedi(ses, wc, p), [false], p);
    assert.equal(ses.controllo(wc, p, 'https://video.example', {}), false, p);
  }
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: [] }), [false], 'lo schermo senza un gesto sulla pagina: no, senza domanda');
});

// L'elenco dei font installati è uguale in ogni sito e in ogni sessione: un clic su un banner non lo consegna (#1524).
test('i font del computer, che Electron non fa chiedere, non passano nemmeno dopo un gesto sulla pagina', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://grafica.example/');
  Permessi.seguiGesti(wc);
  assert.equal(ses.controllo(wc, 'local-fonts', 'https://grafica.example', {}), false);
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  assert.equal(ses.controllo(wc, 'local-fonts', 'https://grafica.example', { requestingUrl: 'https://grafica.example/' }), false);
});

// I nomi di microfoni, fotocamere e uscite audio Chromium li dà a chi il controllo con securityOrigin dice sì; il controllo
// senza securityOrigin è permissions.query, che resta «da chiedere» (#1524).
test('l\'elenco dei dispositivi ha i nomi solo dopo un sì vero, parte per parte; permissions.query resta com\'era', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://riunione.example/stanza');
  const elenco = (mediaType, o = 'https://riunione.example/') => ({ isMainFrame: true, mediaType, requestingUrl: 'https://riunione.example/stanza', securityOrigin: o });
  assert.equal(ses.controllo(wc, 'media', 'https://riunione.example/stanza', elenco('audio')), false, 'mai deciso: niente nomi');
  assert.equal(ses.controllo(wc, 'media', 'https://riunione.example/stanza', elenco('video')), false);
  assert.equal(ses.controllo(wc, 'media', 'https://riunione.example/stanza', elenco('unknown')), false);
  assert.equal(ses.controllo(wc, 'speaker-selection', 'https://riunione.example/stanza', {}), false, 'le uscite non passano da sé');
  assert.equal(ses.controllo(wc, 'media', 'https://riunione.example/stanza', { mediaType: 'audio', requestingUrl: 'https://riunione.example/stanza' }), true,
    'permissions.query: «posso chiedere?»');
  chiedi(ses, wc, 'media', { mediaTypes: ['audio'], securityOrigin: 'https://riunione.example/' });
  Permessi.rispondi(ses.avvisi.at(-1).dati.id, true);
  assert.equal(ses.controllo(wc, 'media', 'https://riunione.example/stanza', elenco('audio')), true, 'dopo Consenti');
  assert.equal(ses.controllo(wc, 'media', 'https://riunione.example/stanza', elenco('video')), false, 'la fotocamera resta senza nomi');
  assert.equal(ses.controllo(wc, 'media', 'https://riunione.example/stanza', elenco('audio', 'https://incorporato.example/')), true,
    'il riquadro a cui la pagina delega il microfono ha il sì della pagina, come in Chrome');
  const altro = wcFinto('https://altro.example/');
  assert.equal(ses.controllo(altro, 'media', 'https://altro.example/', { mediaType: 'audio', securityOrigin: 'https://altro.example/' }), false, 'un altro sito');
  const home = wcFinto('filo://newtab/');
  assert.equal(ses.controllo(home, 'media', 'filo://newtab/', { mediaType: 'audio', requestingUrl: 'filo://newtab/', securityOrigin: 'https://mappa.example/' }), false,
    'un riquadro web in una pagina di Filo risponde per sé');
  assert.equal(ses.controllo(home, 'media', 'filo://newtab/', { mediaType: 'audio', requestingUrl: 'filo://newtab/', securityOrigin: 'filo://newtab/' }), true, 'Filo stesso');

  chiedi(ses, wc, 'media', { mediaTypes: ['video'] });
  Permessi.rispondi(ses.avvisi.at(-1).dati.id, false);
  assert.equal(ses.controllo(wc, 'media', 'https://riunione.example/stanza', elenco('video')), false, 'dopo il no');
  assert.equal(ses.controllo(wc, 'media', 'https://riunione.example/stanza', { mediaType: 'video' }), false, 'e permissions.query lo dice');
});

// Filo sono solo le sue pagine: un blob porta l'origine del sito che l'ha creato (#591, giro 20).
test('un documento blob di un sito è quel sito: chiede col suo nome e non ha sì di comodo', () => {
  const ses = sessioneFinta();
  const blob = wcFinto('blob:https://offerta.example/6f1c2d3e-0000-4000-8000-000000000000');
  blob.session = ses;
  assert.deepEqual(chiedi(ses, blob, 'media', { mediaTypes: ['audio', 'video'] }), []);
  assert.equal(ses.avvisi.at(-1).dati.host, 'offerta.example');
  assert.deepEqual(chiedi(ses, blob, 'clipboard-read'), []);
  assert.equal(ses.controllo(blob, 'notifications', 'https://offerta.example', {}), false);
  assert.equal(Permessi.statoNotifiche(ses, 'blob:https://offerta.example/x'), 'default');
  assert.deepEqual(chiedi(ses, blob, 'openExternal', { externalURL: 'search-ms:query=x' }), [false]);
  for (const url of ['about:blank', 'data:text/html,x', 'blob:null/1234', 'file:///tmp/fattura.html']) {
    assert.deepEqual(chiedi(ses, wcFinto(url), 'media', { mediaTypes: ['audio'] }), [false], url);
    assert.equal(ses.controllo(wcFinto(url), 'clipboard-read', '', {}), false, url);
  }
  assert.deepEqual(chiedi(ses, wcFinto('blob:filo://editor/abc'), 'clipboard-read'), [true], 'un blob di Filo è Filo');
  const home = wcFinto('filo://newtab/');
  assert.deepEqual(chiedi(ses, home, 'geolocation', { requestingUrl: 'https://mappa.example/riquadro' }), []);
  assert.equal(ses.avvisi.at(-1).dati.host, 'mappa.example', 'un riquadro web in una pagina di Filo chiede per sé');
});

// Le risposte delle sessioni su disco restano, come in Chrome; incognito e siti usa-e-getta no (#591, giro 20).
test('nelle sessioni su disco le risposte si condividono, si salvano, si elencano tutte e si tolgono una per una', async () => {
  const salvate = [];
  Permessi._usaDisco({ get: async () => ({ sitePermissions: { 'https://riunione.example|audio': true, rotta: 1 } }), set: async (o) => { salvate.push(o); } });
  await Permessi.carica();
  const disco = sessioneFinta();
  disco.isPersistent = () => true;
  const altra = sessioneFinta();
  altra.isPersistent = () => true;
  const incognito = sessioneFinta();
  incognito.isPersistent = () => false;
  const wc = wcFinto('https://posta.example/');
  wc.session = disco;
  Permessi.seguiGesti(wc);
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  chiedi(disco, wc, 'notifications');
  Permessi.rispondi(disco.avvisi.at(-1).dati.id, true);
  assert.equal(Permessi.statoNotifiche(altra, 'https://posta.example/'), 'granted');
  assert.deepEqual(salvate.at(-1), { sitePermissions: { 'https://riunione.example|audio': true, 'https://posta.example|notifiche': true } });
  assert.deepEqual(chiedi(disco, wcFinto('https://riunione.example/'), 'media', { mediaTypes: ['audio'] }), [true], 'letto dal disco all\'avvio');
  assert.equal(Permessi.statoNotifiche(incognito, 'https://posta.example/'), 'default', 'l\'incognito non eredita');
  assert.ok(Permessi.scelteRicordate().some((x) => x.origine === 'https://posta.example' && x.parte === 'notifiche' && x.si === true
    && x.dominio === 'posta.example'));
  assert.equal(Permessi.togliScelta('https://posta.example', 'notifiche'), true);
  assert.equal(Permessi.statoNotifiche(disco, 'https://posta.example/'), 'default');
  assert.equal(Permessi.togliScelta('https://posta.example', 'notifiche'), false);
  assert.deepEqual(salvate.at(-1), { sitePermissions: { 'https://riunione.example|audio': true } });
  Permessi.togliScelta('https://riunione.example', 'audio');
});

// Il controllo dice sì anche a chi nessuno ha risposto: la pagina legge «da chiedere» finché `siDato` non vede un sì vero,
// del suo sito e solo per fotocamera, microfono e posizione (#1057).
test('siDato: sì solo dopo Consenti, per quel sito e per quella parte', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://riunione.example/stanza');
  assert.equal(ses.controllo(wc, 'media', 'https://riunione.example', { mediaType: 'audio' }), true);
  assert.equal(Permessi.siDato(ses, 'https://riunione.example/stanza', 'audio'), false, 'mai deciso');
  chiedi(ses, wc, 'media', { mediaTypes: ['audio'] });
  Permessi.rispondi(ses.avvisi.at(-1).dati.id, true);
  assert.equal(Permessi.siDato(ses, 'https://riunione.example/altra', 'audio'), true);
  assert.equal(Permessi.siDato(ses, 'https://riunione.example/', 'video'), false, 'la fotocamera resta da chiedere');
  assert.equal(Permessi.siDato(ses, 'https://altro.example/', 'audio'), false, 'un altro sito');
  assert.equal(Permessi.siDato(ses, 'about:blank', 'audio'), false);
  assert.equal(Permessi.siDato(ses, 'https://riunione.example/', 'appunti'), false, 'solo le parti lette dalla pagina');
  assert.equal(Permessi.siDato(ses, 'https://riunione.example/', 'strumenti'), false, 'il MIDI resta da chiedere');
  chiedi(ses, wc, 'midiSysex');
  Permessi.rispondi(ses.avvisi.at(-1).dati.id, true);
  assert.equal(Permessi.siDato(ses, 'https://riunione.example/', 'strumenti'), true, 'dopo Consenti agli strumenti');
});

// Ogni nome che Electron può mandare ai gestori ha una regola: un nome nuovo, qui, è un rosso e non un no silenzioso.
test('ogni permesso che Electron dichiara è chiesto, concesso o negato per una ragione scritta', () => {
  // Risolto come un pacchetto: nella prova degli unit sulla fusione node_modules sta una cartella più su (#929).
  const dts = readFileSync(createRequire(import.meta.url).resolve('electron/electron.d.ts'), 'utf8');
  const nomi = new Set();
  for (const firma of ['setPermissionRequestHandler(handler: ((webContents: WebContents, permission: ',
    'setPermissionCheckHandler(handler: ((webContents: (WebContents) | (null), permission: ']) {
    const i = dts.indexOf(firma);
    assert.ok(i >= 0, firma);
    const union = dts.slice(i + firma.length, dts.indexOf(', ', i + firma.length));
    for (const m of union.matchAll(/'([^']+)'/g)) nomi.add(m[1]);
  }
  assert.ok(nomi.size > 15);
  const regole = new Set([...Object.keys(Permessi.TIPI), ...Object.keys(Permessi.SECONDO_L_ACCESSO), ...Permessi.INNOCUI,
    ...Permessi.NON_DISPONIBILI, 'openExternal']);
  assert.deepEqual([...nomi].filter((n) => !regole.has(n)), []);
});

test('notifiche: senza un gesto sulla pagina è un no non ricordato; dopo un clic si chiede, e il controllo dice il vero', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://posta.example/');
  Permessi.seguiGesti(wc);
  assert.equal(ses.controllo(wc, 'notifications', 'https://posta.example', {}), false, 'non ancora concesse');
  assert.deepEqual(chiedi(ses, wc, 'notifications'), [false], 'chiesto da solo, al caricamento');
  assert.equal(ses.avvisi.length, 0, 'nessuna domanda senza gesto');
  wc.emetti('input-event', {}, { type: 'mouseMove' });
  assert.deepEqual(chiedi(ses, wc, 'notifications'), [false], 'passare col mouse non è un gesto');
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  const esiti = chiedi(ses, wc, 'notifications');
  const domanda = ses.avvisi.find((a) => a.evento === 'chiedi');
  assert.equal(domanda.dati.tipo, 'notifiche');
  Permessi.rispondi(domanda.dati.id, true);
  assert.deepEqual(esiti, [true]);
  assert.equal(ses.controllo(wc, 'notifications', 'https://posta.example', {}), true);
});

test('un\'altra applicazione si apre solo dalla lista delle schede e solo dopo un gesto sulla pagina', () => {
  const ses = { setPermissionCheckHandler() {} };
  ses.setPermissionRequestHandler = (fn) => { ses.richiesta = fn; };
  Permessi.installa(ses, { esterno: (u) => /^mailto:/.test(String(u)) });
  const wc = wcFinto('https://negozio.example/');
  Permessi.seguiGesti(wc);
  assert.deepEqual(chiedi(ses, wc, 'openExternal', { externalURL: 'mailto:a@b.example' }), [false], 'senza gesto');
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  assert.deepEqual(chiedi(ses, wc, 'openExternal', { externalURL: 'search-ms:query=x' }), [false], 'fuori lista');
  assert.deepEqual(chiedi(ses, wc, 'openExternal', { externalURL: 'mailto:a@b.example' }), [true]);
  wc.emetti('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.deepEqual(chiedi(ses, wc, 'openExternal', { externalURL: 'mailto:a@b.example' }), [false], 'il clic non vale per la pagina dopo');
});

test('le scelte ricordate per un sito si leggono e si azzerano; dopo si torna a chiedere', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://riunione.example/stanza');
  wc.session = ses;
  chiedi(ses, wc, 'media', { mediaTypes: ['audio'] });
  Permessi.rispondi(ses.avvisi.find((a) => a.evento === 'chiedi').dati.id, false);
  assert.deepEqual(Permessi.scelteDi(wc).scelte, [{ parte: 'audio', si: false }]);
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: ['audio'] }), [false]);
  assert.deepEqual(Permessi.dimentica(wc), { tolte: 1, ricarica: false });
  assert.deepEqual(Permessi.scelteDi(wc).scelte, []);
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: ['audio'] }), [], 'si chiede di nuovo');
});

test('la domanda nomina il dominio registrato: la parte davanti la sceglie chi ha il sito', () => {
  assert.deepEqual(Permessi.nomeDaMostrare('https://meet.google.com.verifica-sessione.attacco.example:8443'),
    { sotto: 'meet.google.com.verifica-sessione', dominio: 'attacco.example:8443' });
  assert.deepEqual(Permessi.nomeDaMostrare('https://riunione.example'), { sotto: '', dominio: 'riunione.example' });
  assert.deepEqual(Permessi.nomeDaMostrare('http://127.0.0.1:3000'), { sotto: '', dominio: '127.0.0.1:3000' });
  assert.equal(Permessi.nomeDaMostrare('https://bbc.co.uk').dominio, 'bbc.co.uk');
});

// Quello che Chrome concede di fabbrica, senza domanda: una pagina che lo chiede non deve leggere «bloccato» (#591, giro 19).
test('passa senza domanda tutto quello che Chrome concede di fabbrica', () => {
  const chrome = ['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write', 'mediaKeySystem',
    'screen-wake-lock', 'background-sync', 'background-fetch', 'sensors', 'payment-handler', 'persistent-storage'];
  for (const p of chrome) assert.equal(Permessi.INNOCUI.has(p), true, p);
});

test('le notifiche si leggono «da chiedere» finché l\'utente non decide; il no e l\'azzeramento si vedono', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://posta.example/in-arrivo');
  wc.session = ses;
  Permessi.seguiGesti(wc);
  assert.equal(Permessi.statoNotifiche(ses, 'https://posta.example/in-arrivo'), 'default');
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  chiedi(ses, wc, 'notifications');
  Permessi.rispondi(ses.avvisi.find((a) => a.evento === 'chiedi').dati.id, false);
  assert.equal(Permessi.statoNotifiche(ses, 'https://posta.example/altra'), 'denied');
  assert.equal(Permessi.statoNotifiche(ses, 'https://altro.example/'), 'default', 'un altro sito non eredita il no');
  assert.deepEqual(Permessi.dimentica(wc), { tolte: 1, ricarica: true }, 'la pagina aperta legge il no finché non si ricarica');
  assert.equal(Permessi.statoNotifiche(ses, 'https://posta.example/'), 'default');
  assert.equal(Permessi.statoNotifiche(ses, 'filo://options/'), 'default');
});

// #737.1 — col blocco dei popup una pagina apre una finestra solo dopo un gesto vero dell'utente, una per gesto.
test('una finestra la apre solo un gesto vero di adesso, uno per finestra, anche dentro un riquadro', () => {
  let ora = 1_000_000;
  const orologio = mock.method(Date, 'now', () => ora);
  try {
    const wc = wcFinto('https://notizie.example/');
    wc.mainFrame = { parent: null };
    Permessi.seguiGesti(wc);
    assert.equal(Permessi.gestoPerUnaFinestra(wc), false, 'nessun gesto');
    wc.emetti('input-event', {}, { type: 'mouseMove' });
    assert.equal(Permessi.gestoPerUnaFinestra(wc), false, 'il puntatore che passa non è un gesto');
    wc.emetti('input-event', {}, { type: 'mouseDown' });
    assert.equal(Permessi.gestoPerUnaFinestra(wc), false, 'l\'input visto dal main non sa ancora se è caduto su Filo');
    Permessi.gestoDellaPagina(wc, wc.mainFrame);
    ora += 50;
    assert.equal(Permessi.gestoPerUnaFinestra(wc), true);
    assert.equal(Permessi.gestoPerUnaFinestra(wc), false, 'la seconda finestra dello stesso clic');

    ora += 300;
    Permessi.gestoDellaPagina(wc, { parent: wc.mainFrame });
    assert.equal(Permessi.gestoPerUnaFinestra(wc), true, 'il clic vero nel riquadro di un altro sito');

    ora += 300;
    Permessi.gestoDellaPagina(wc, { parent: wc.mainFrame });
    ora += Permessi.GESTO_MS + 1;
    assert.equal(Permessi.gestoPerUnaFinestra(wc), false, 'un gesto di cinque secondi fa non vale più');

    Permessi.gestoDellaPagina(wc, wc.mainFrame, { key: 'Enter' });
    wc.emetti('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    assert.equal(Permessi.gestoPerUnaFinestra(wc), false, 'il gesto non passa alla pagina dove porta');
  } finally { orologio.mock.restore(); }
});

// #737.1 giro 2 — il rilascio dello stesso clic o il carattere dello stesso tasto non aprono una seconda finestra.
test('un gesto apre una finestra sola: la pressione la apre, il rilascio dello stesso clic no', async () => {
  let ora = 2_000_000;
  const orologio = mock.method(Date, 'now', () => ora);
  try {
    const wc = wcFinto('https://notizie.example/');
    wc.mainFrame = { parent: null };
    Permessi.seguiGesti(wc);
    wc.emetti('input-event', {}, { type: 'mouseDown' });
    Permessi.gestoDellaPagina(wc, wc.mainFrame);
    assert.equal(Permessi.gestoPerUnaFinestra(wc), true, 'alla pressione');
    ora += 150;
    wc.emetti('input-event', {}, { type: 'mouseUp' });
    assert.equal(Permessi.gestoPerUnaFinestra(wc), false, 'al rilascio dello stesso clic');

    ora += 400;
    wc.emetti('input-event', {}, { type: 'rawKeyDown', key: 'a' });
    wc.emetti('before-input-event', { defaultPrevented: false }, { type: 'keyDown', key: 'a' });
    await new Promise((r) => setImmediate(r));
    Permessi.gestoDellaPagina(wc, wc.mainFrame, { key: 'a' });
    assert.equal(Permessi.gestoPerUnaFinestra(wc), true, 'al tasto');
    ora += 80;
    wc.emetti('input-event', {}, { type: 'char', key: 'a' });
    assert.equal(Permessi.gestoPerUnaFinestra(wc), false, 'il carattere dello stesso tasto');
    ora += 20;
    Permessi.gestoDellaPagina(wc, { parent: wc.mainFrame });
    ora += 300;
    Permessi.gestoDellaPagina(wc, wc.mainFrame);
    assert.equal(Permessi.gestoPerUnaFinestra(wc), true, 'un clic nuovo è un gesto nuovo');
  } finally { orologio.mock.restore(); }
});

test('il clic che Filo dà da sé a una pagina non è un gesto, nemmeno riferito dal riquadro; i tasti dell\'utente sì', async () => {
  let ora = 3_000_000;
  const orologio = mock.method(Date, 'now', () => ora);
  try {
    const wc = wcFinto('https://blog.example/');
    wc.mainFrame = { parent: null };
    Permessi.seguiGesti(wc);
    Permessi.clicDiFilo(wc);
    wc.emetti('input-event', {}, { type: 'mouseDown' });
    Permessi.gestoDellaPagina(wc, wc.mainFrame);
    wc.emetti('input-event', {}, { type: 'mouseUp' });
    ora += 300;
    Permessi.gestoDellaPagina(wc, { parent: wc.mainFrame });
    assert.equal(Permessi.gestoPerUnaFinestra(wc), false, 'nessuna finestra dal clic di Filo');
    Permessi.gestoDellaPagina(wc, wc.mainFrame, { key: 'x' });
    assert.equal(Permessi.gestoPerUnaFinestra(wc), true, 'il tasto premuto intanto dall\'utente');
    ora += 2000;
    Permessi.gestoDellaPagina(wc, wc.mainFrame);
    assert.equal(Permessi.gestoPerUnaFinestra(wc), true, 'passato il clic di Filo, il clic dell\'utente torna a valere');
  } finally { orologio.mock.restore(); }
});

test('un modificatore da solo o una scorciatoia di Filo non sono un gesto dato alla pagina (#737.1)', async () => {
  require('../../src/shared/tasti.js');
  const tasto = (key, mods = {}) => ({ type: 'rawKeyDown', key, control: false, alt: false, shift: false, meta: false, ...mods });
  for (const k of ['Control', 'Shift', 'Alt', 'Meta', 'Escape']) assert.equal(Permessi.tastoPerLaPagina(tasto(k)), false, k);
  assert.equal(Permessi.tastoPerLaPagina(tasto('t', { control: true })), false, 'nuova scheda');
  assert.equal(Permessi.tastoPerLaPagina(tasto('w', { control: true })), false, 'chiudi scheda');
  assert.equal(Permessi.tastoPerLaPagina(tasto('a')), true, 'una lettera scritta nella pagina');
  assert.equal(Permessi.tastoPerLaPagina(tasto('Enter')), true);
  assert.equal(Permessi.tastoPerLaPagina({ type: 'mouseDown' }), true);

  const wc = wcFinto('https://sito.test/');
  Permessi.seguiGesti(wc);
  wc.emetti('input-event', {}, tasto('Control', { control: true }));
  wc.emetti('before-input-event', { defaultPrevented: false }, { ...tasto('x'), type: 'keyDown' });
  await new Promise((r) => setImmediate(r));
  assert.equal(Permessi.gestoPerUnaFinestra(wc), false, 'il main da solo non dà finestre: lo dice il preload');
  // Dal preload, con i nomi del DOM: un tasto riservato che arriva alla pagina non è suo.
  Permessi.gestoDellaPagina(wc, null, { key: 'Control', ctrlKey: true });
  Permessi.gestoDellaPagina(wc, null, { key: 't', code: 'KeyT', ctrlKey: true });
  assert.equal(Permessi.gestoPerUnaFinestra(wc), false, 'nessun tasto è della pagina');
  Permessi.gestoDellaPagina(wc, null, { key: 'x', code: 'KeyX' });
  assert.equal(Permessi.gestoPerUnaFinestra(wc), true, 'il tasto scritto nella pagina sì');
});

test('il riquadro di un altro sito scarta gli stessi tasti della pagina', () => {
  const preload = readFileSync(new URL('../../src/preload/page-preload.js', import.meta.url), 'utf8');
  const m = /const SENZA_GESTO = new Set\((\[[^\]]*\])\)/.exec(preload);
  assert.ok(m, 'la lista nel preload del riquadro');
  assert.deepEqual(JSON.parse(m[1].replace(/'/g, '"')), [...Permessi.TASTI_SENZA_GESTO]);
});

// #737.1 giro 3 — il gesto vale per il frame che l'ha ricevuto e i suoi antenati, non per i riquadri di altri siti.
test('il clic sulla pagina non apre la finestra che chiede un riquadro di un altro sito; il clic nel riquadro sì', () => {
  let ora = 4_000_000;
  const orologio = mock.method(Date, 'now', () => ora);
  try {
    const wc = wcFinto('https://notizie.example/articolo');
    wc.mainFrame = { parent: null, origin: 'https://notizie.example', url: 'https://notizie.example/articolo' };
    const pubblicita = { parent: wc.mainFrame, origin: 'https://pubblicita.example', url: 'https://pubblicita.example/b' };
    Permessi.seguiGesti(wc);
    Permessi.gestoDellaPagina(wc, wc.mainFrame);
    assert.equal(Permessi.gestoPerUnaFinestra(wc, { url: 'https://pubblicita.example/', policy: 'strict-origin-when-cross-origin' }), false, 'il riquadro non l\'ha avuto');
    assert.equal(Permessi.gestoPerUnaFinestra(wc, { url: 'https://notizie.example/articolo' }), true, 'la pagina sì, una volta');

    ora += 400;
    Permessi.gestoDellaPagina(wc, pubblicita);
    assert.equal(Permessi.gestoPerUnaFinestra(wc, { url: 'https://pubblicita.example/' }), true, 'il clic dentro il riquadro');
    ora += 400;
    Permessi.gestoDellaPagina(wc, pubblicita);
    assert.equal(Permessi.gestoPerUnaFinestra(wc, { url: 'https://notizie.example/' }), true, 'come in Chromium il gesto sale alla pagina che lo contiene');

    ora += 400;
    Permessi.gestoDellaPagina(wc, wc.mainFrame);
    ora += 20;
    Permessi.gestoDellaPagina(wc, pubblicita);
    assert.equal(Permessi.gestoPerUnaFinestra(wc, { url: 'https://pubblicita.example/' }), true, 'lo stesso clic visto da tutti e due è un gesto solo, del riquadro');
    assert.equal(Permessi.gestoPerUnaFinestra(wc, { url: 'https://notizie.example/' }), false, 'e apre una finestra sola');

    ora += 400;
    Permessi.gestoDellaPagina(wc, wc.mainFrame);
    assert.equal(Permessi.gestoPerUnaFinestra(wc, { url: '' }), true, 'chi nasconde da dove chiede resta «la scheda»');
  } finally { orologio.mock.restore(); }
});

test('il gesto dato all\'interfaccia di Filo non apre finestre alla pagina; l\'apertura scelta dall\'utente passa una volta, anche a gesto speso', () => {
  let ora = 1_000_000;
  const orologio = mock.method(Date, 'now', () => ora);
  const wc = wcFinto('https://sito.example/');
  Permessi.seguiGesti(wc);
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  assert.equal(Permessi.perUnaFinestra(wc, 'https://pubblicita.example/', 'https://sito.example/'), false, 'la pagina che chiede prima che il preload dica di chi è il clic');
  Permessi.gestoDiFilo(wc);
  wc.emetti('input-event', {}, { type: 'mouseUp' });
  assert.equal(Permessi.perUnaFinestra(wc, 'https://pubblicita.example/', 'https://sito.example/'), false, 'il clic sul menu di Filo non è della pagina');

  Permessi.aperturaScelta(wc, 'https://sito.example/articolo');
  assert.equal(Permessi.perUnaFinestra(wc, 'https://sito.example/articolo', 'https://sito.example/'), true, 'la voce scelta si apre');
  assert.equal(Permessi.perUnaFinestra(wc, 'https://sito.example/articolo', 'https://sito.example/'), false, 'una volta sola');

  ora += 1000;
  Permessi.gestoDellaPagina(wc, null);
  assert.equal(Permessi.perUnaFinestra(wc, 'https://pubblicita.example/', 'https://sito.example/'), true, 'la pubblicità spende il clic sul link');
  Permessi.aperturaScelta(wc, 'https://sito.example/link');
  assert.equal(Permessi.perUnaFinestra(wc, 'https://sito.example/link', 'https://sito.example/'), true, 'il link cliccato si apre lo stesso');

  ora += 1000;
  Permessi.gestoDellaPagina(wc, null);
  Permessi.aperturaScelta(wc, 'https://sito.example/altro');
  assert.equal(Permessi.perUnaFinestra(wc, 'https://sito.example/altro', 'https://sito.example/'), true);
  assert.equal(Permessi.perUnaFinestra(wc, 'https://pubblicita.example/', 'https://sito.example/'), false, 'il link spende anche il gesto: niente pubblicità dopo');
  orologio.mock.restore();
});

test('un sito usa-e-getta della Privacy buttato all\'uscita dimentica le risposte; una sessione su disco no', () => {
  const effimera = sessioneFinta();
  effimera.isPersistent = () => false;
  const wc = wcFinto('https://posta.example/in-arrivo');
  wc.session = effimera;
  Permessi.seguiGesti(wc);
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  chiedi(effimera, wc, 'notifications');
  Permessi.rispondi(effimera.avvisi.find((a) => a.evento === 'chiedi').dati.id, true);
  assert.equal(Permessi.statoNotifiche(effimera, 'https://posta.example/'), 'granted');
  Permessi.dimenticaSessione(effimera);
  assert.equal(Permessi.statoNotifiche(effimera, 'https://posta.example/'), 'default', 'il sito riaperto deve richiedere');

  const disco = { isPersistent: () => true };
  const prima = Permessi.scelteRicordate().length;
  Permessi.dimenticaSessione(disco);
  assert.equal(Permessi.scelteRicordate().length, prima);
});

// #1069 — la cartella scelta per farla leggere non diventa scrivibile senza un sì. Electron manda `fileSystem` per la
// lettura di una cartella scelta, per requestPermission e per la scrittura su un file aperto; il salvataggio no.
const cartella = (accesso, filePath = '/home/anna/foto da caricare', isDirectory = true) => ({ fileAccessType: accesso, filePath, isDirectory });

test('leggere la cartella o il file scelti nel selettore passa senza domanda: la scelta è il consenso', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://carica-foto.example/');
  assert.equal(Permessi.INNOCUI.has('fileSystem'), false);
  assert.deepEqual(chiedi(ses, wc, 'fileSystem', cartella('readable')), [true]);
  assert.deepEqual(chiedi(ses, wc, 'fileSystem', cartella('readable', '/home/anna/nota.txt', false)), [true]);
  assert.equal(ses.avvisi.length, 0);
  assert.equal(ses.controllo(wc, 'fileSystem', 'https://carica-foto.example', cartella('readable')), true, 'il controllo non chiude la lettura');
  // Da Electron 39 il controllo è lo stato del file: un sì qui scriverebbe senza domanda.
  assert.equal(ses.controllo(null, 'fileSystem', 'https://carica-foto.example/', cartella('writable')), false);
  assert.equal(ses.controllo(null, 'fileSystem', 'https://carica-foto.example/', {}), false);
});

test('scrivere nella cartella data da leggere si chiede col nome della cartella; il no resta per il sito, la lettura no', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://carica-foto.example/album');
  wc.session = ses;
  const esiti = chiedi(ses, wc, 'fileSystem', cartella('writable'));
  assert.deepEqual(esiti, [], 'nessuna scrittura prima della risposta');
  const domanda = ses.avvisi.find((a) => a.evento === 'chiedi').dati;
  assert.equal(domanda.tipo, 'file');
  assert.deepEqual(domanda.parti, ['file']);
  assert.equal(domanda.host, 'carica-foto.example');
  assert.deepEqual(domanda.oggetto, { nome: 'foto da caricare', percorso: '/home/anna/foto da caricare', cartella: true });
  Permessi.rispondi(domanda.id, false);
  assert.deepEqual(esiti, [false]);
  assert.deepEqual(chiedi(ses, wc, 'fileSystem', cartella('writable', '/home/anna/Documenti')), [false], 'il no vale per il sito');
  assert.equal(ses.avvisi.filter((a) => a.evento === 'chiedi').length, 1);
  assert.equal(ses.controllo(wc, 'fileSystem', 'https://carica-foto.example', { fileAccessType: 'writable' }), false);
  assert.deepEqual(chiedi(ses, wc, 'fileSystem', cartella('readable')), [true], 'leggere resta concesso');
  assert.deepEqual(Permessi.scelteDi(wc).scelte, [{ parte: 'file', si: false }]);
  assert.deepEqual(Permessi.dimentica(wc), { tolte: 1, ricarica: false });
  assert.deepEqual(chiedi(ses, wc, 'fileSystem', cartella('writable')), [], 'azzerato: si richiede');
});

test('il sì alla scrittura vale per il sito; due richieste insieme fanno una domanda sola; un altro sito chiede di nuovo', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://editor.example/');
  const a = chiedi(ses, wc, 'fileSystem', cartella('writable', '/home/anna/progetto'));
  const b = chiedi(ses, wc, 'fileSystem', cartella('writable', '/home/anna/progetto/nuovo.txt', false));
  assert.equal(ses.avvisi.filter((x) => x.evento === 'chiedi').length, 1);
  Permessi.rispondi(ses.avvisi.at(-1).dati.id, true);
  assert.deepEqual([a, b], [[true], [true]]);
  assert.deepEqual(chiedi(ses, wc, 'fileSystem', cartella('writable', '/home/anna/altro')), [true]);
  assert.equal(ses.controllo(wc, 'fileSystem', 'https://editor.example', { fileAccessType: 'writable' }), true);
  assert.deepEqual(chiedi(ses, wcFinto('https://altro.example/'), 'fileSystem', cartella('writable')), []);
});

test('la scrittura su un file aperto per leggerlo si chiede col nome del file; senza dettagli si chiede lo stesso', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://appunti.example/');
  chiedi(ses, wc, 'fileSystem', cartella('writable', '/home/anna/nota.txt', false));
  assert.deepEqual(ses.avvisi.at(-1).dati.oggetto, { nome: 'nota.txt', percorso: '/home/anna/nota.txt', cartella: false });
  const wc2 = wcFinto('https://vago.example/');
  assert.deepEqual(chiedi(ses, wc2, 'fileSystem', {}), [], 'un accesso che non dice cos\'è non passa da lettura');
  assert.deepEqual(ses.avvisi.at(-1).dati.oggetto, { nome: '', percorso: '', cartella: false });
  assert.deepEqual(chiedi(ses, wcFinto('filo://editor/'), 'fileSystem', cartella('writable')), [true], 'Filo stesso non si chiede');
});

test('dalla chat la risposta sulla modifica dei file si toglie come le altre', async () => {
  Permessi._usaDisco({ get: async () => ({}), set: async () => {} });
  const disco = sessioneFinta();
  disco.isPersistent = () => true;
  const wc = wcFinto('https://www.carica-foto.example/');
  chiedi(disco, wc, 'fileSystem', cartella('writable'));
  Permessi.rispondi(disco.avvisi.at(-1).dati.id, false);
  assert.ok(Permessi.righeRicordate().some((r) => /carica-foto\.example · modifica dei file: negato|carica-foto\.example · file: negato/.test(r)));
  const r = Permessi.togliPerChat('carica-foto.example', 'cartelle');
  assert.equal(r.tolte.length, 1);
  assert.deepEqual(chiedi(disco, wc, 'fileSystem', cartella('writable')), [], 'tolta: si richiede');
});

// Electron 39+ non manda più la richiesta di scrittura su una maniglia che il sito ha già: la fa partire la pagina.
test('la pagina chiede di scrivere sulla cartella appena controllata: dopo un gesto vero, col suo nome, e il sì apre il controllo', async () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://carica-foto.example/album');
  wc.session = ses;
  Permessi.seguiGesti(wc);
  assert.equal(await Permessi.chiediScrittura(wc), null, 'nessun file controllato: niente domanda');
  assert.equal(ses.controllo(null, 'fileSystem', 'https://carica-foto.example/', cartella('writable')), false);
  assert.equal(await Permessi.chiediScrittura(wc), null, 'senza un gesto vero niente domanda');
  assert.equal(ses.avvisi.length, 0);
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  const esito = Permessi.chiediScrittura(wc);
  const domanda = ses.avvisi.find((a) => a.evento === 'chiedi').dati;
  assert.deepEqual(domanda.oggetto, { nome: 'foto da caricare', percorso: '/home/anna/foto da caricare', cartella: true });
  Permessi.rispondi(domanda.id, true);
  assert.equal(await esito, true);
  assert.equal(ses.controllo(null, 'fileSystem', 'https://carica-foto.example/', cartella('writable')), true);
  assert.equal(ses.controllo(null, 'fileSystem', 'https://altro.example/', cartella('writable')), false, 'il sì vale per quel sito');
});

test('il file scelto in «Salva con nome» si scrive senza domanda, anche dopo un no; un file con dentro qualcosa no', (t) => {
  const dir = cartellaTemporanea('filo-test-salva-');
  t.after(() => togliCartella(dir));
  const ses = sessioneFinta();
  const wc = wcFinto('https://editor.example/');
  chiedi(ses, wc, 'fileSystem', cartella('writable', '/home/anna/progetto'));
  Permessi.rispondi(ses.avvisi.at(-1).dati.id, false);
  const salvato = join(dir, 'disegno.svg');
  writeFileSync(salvato, '');
  const pieno = join(dir, 'nota.txt');
  writeFileSync(pieno, 'testo');
  const vecchio = join(dir, 'vuoto.txt');
  writeFileSync(vecchio, '');
  utimesSync(vecchio, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
  const controlla = (p) => ses.controllo(null, 'fileSystem', 'https://editor.example/', cartella('writable', p, false));
  assert.equal(controlla(salvato), true);
  writeFileSync(salvato, '<svg/>');
  assert.equal(controlla(salvato), true, 'resta scrivibile dopo la prima scrittura');
  assert.equal(controlla(pieno), false);
  assert.equal(controlla(vecchio), false);
  assert.equal(ses.controllo(null, 'fileSystem', 'https://editor.example/', cartella('writable', dir, true)), false, 'una cartella non è un salvataggio');
});

// ── #586: lo schermo, i riquadri di altri siti, il segno sulla scheda ──

function sessioneConSchermo() {
  const ses = sessioneFinta();
  ses.setDisplayMediaRequestHandler = (fn) => { ses.schermo = fn; };
  delete ses._filoPermessi;
  Permessi.installa(ses, { schedaDi: () => ({ tabId: 't1', avvisa: (evento, dati) => ses.avvisi.push({ evento, dati }) }) });
  return ses;
}

function fontiFinte(ses) {
  const sorgente = { id: 'screen:1:0', name: 'Schermo' };
  Permessi._usaFontiSchermo(async () => [
    { id: 'screen:1:0', tipo: 'schermo', nome: 'Schermo intero', anteprima: '', sorgente },
    { id: 'window:7:0', tipo: 'finestra', nome: 'Note', anteprima: '', sorgente: { id: 'window:7:0' } },
  ]);
  return sorgente;
}

const attendi = () => new Promise((r) => setImmediate(r));

// Come Chromium: il gestore dello schermo lo chiama solo getDisplayMedia, dentro il sì al permesso.
const getDisplayMedia = (ses, consegne) => (si) => { if (si) ses.schermo({ frame: null }, (f) => consegne.push(f)); };

test('lo schermo: dopo un clic la cornice chiede cosa mostrare, la scelta arriva alla pagina e la volta dopo si richiede', async () => {
  const ses = sessioneConSchermo();
  const sorgente = fontiFinte(ses);
  const wc = wcFinto('https://riunione.example/');
  wc.forcefullyCrashRenderer = () => { wc.fermata = true; };
  Permessi.seguiGesti(wc);
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  const consegne = [];
  const esiti = [];
  const gdm = getDisplayMedia(ses, consegne);
  ses.richiesta(wc, 'media', (si) => { esiti.push(si); gdm(si); }, { mediaTypes: [] });
  await attendi();
  const domanda = ses.avvisi.find((a) => a.evento === 'chiedi' && a.dati.tipo === 'schermo');
  assert.ok(domanda, 'la cornice chiede');
  assert.deepEqual(domanda.dati.fonti.map((f) => f.id), ['screen:1:0', 'window:7:0']);
  assert.equal(domanda.dati.fonti.some((f) => 'sorgente' in f), false, 'alla cornice vanno nomi e anteprime, non gli oggetti');
  assert.deepEqual(esiti, [], 'niente prima della scelta');
  assert.equal(Permessi.rispondi(domanda.dati.id, true, 'screen:1:0'), true);
  assert.deepEqual(esiti, [true]);
  assert.deepEqual(consegne, [{ video: sorgente }]);
  assert.equal(wc.fermata, undefined, 'getDisplayMedia non ferma la pagina');
  assert.deepEqual(Permessi.segniDi(wc), { usati: ['schermo'], negati: [] }, 'il segno sulla scheda dice che vede lo schermo');
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  ses.richiesta(wc, 'media', gdm, { mediaTypes: [] });
  await attendi();
  assert.equal(ses.avvisi.filter((a) => a.evento === 'chiedi' && a.dati.tipo === 'schermo').length, 2, 'si chiede ogni volta');
});

test('lo schermo: Non consentire è un no alla pagina, e una fonte inventata non consegna niente', async () => {
  const ses = sessioneConSchermo();
  fontiFinte(ses);
  const wc = wcFinto('https://riunione.example/');
  wc.forcefullyCrashRenderer = () => {};
  Permessi.seguiGesti(wc);
  for (const [si, fonte] of [[false, undefined], [true, 'screen:99:0']]) {
    wc.emetti('input-event', {}, { type: 'mouseDown' });
    const consegne = [];
    const esiti = [];
    const gdm = getDisplayMedia(ses, consegne);
    ses.richiesta(wc, 'media', (ok) => { esiti.push(ok); gdm(ok); }, { mediaTypes: [] });
    await attendi();
    const domanda = ses.avvisi.filter((a) => a.evento === 'chiedi' && a.dati.tipo === 'schermo').at(-1);
    Permessi.rispondi(domanda.dati.id, si, fonte);
    assert.deepEqual(esiti, [false], `${si} ${fonte}`);
    assert.deepEqual(consegne, [], `${si} ${fonte}`);
  }
  assert.deepEqual(Permessi.segniDi(wc), { usati: [], negati: ['schermo'] });
});

test('la strada vecchia per lo schermo (getUserMedia con chromeMediaSource) non arriva al sito: la pagina si ferma', async () => {
  const ses = sessioneConSchermo();
  fontiFinte(ses);
  const wc = wcFinto('https://spia.example/');
  wc.forcefullyCrashRenderer = () => { wc.fermata = true; };
  Permessi.seguiGesti(wc);
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: [] }), [false], 'senza un gesto: no, senza domanda né pagina fermata');
  assert.equal(wc.fermata, undefined);
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  const esiti = chiedi(ses, wc, 'media', { mediaTypes: [] });
  await attendi();
  const domanda = ses.avvisi.find((a) => a.evento === 'chiedi' && a.dati.tipo === 'schermo');
  Permessi.rispondi(domanda.dati.id, true, 'screen:1:0');
  assert.deepEqual(esiti, [true]);
  assert.equal(wc.fermata, true, 'senza il gestore dello schermo il sì non resta alla pagina');
  assert.equal(Permessi.segniDi(wc), null, 'e non si dice che la usa');
});

test('l\'avviso della strada vecchia fa negare dopo la scelta solo la domanda dell\'origine che lo manda', async () => {
  const ses = sessioneConSchermo();
  const sorgente = fontiFinte(ses);
  const wc = wcFinto('https://riunione.example/');
  wc.forcefullyCrashRenderer = () => { wc.fermata = true; };
  Permessi.seguiGesti(wc);
  const presenta = async (avviso) => {
    if (avviso) Permessi.schermoVecchio(wc, { url: avviso, origin: new URL(avviso).origin });
    wc.emetti('input-event', {}, { type: 'mouseDown' });
    const consegne = [];
    const esiti = [];
    const gdm = getDisplayMedia(ses, consegne);
    ses.richiesta(wc, 'media', (si) => { esiti.push(si); gdm(si); }, { mediaTypes: [], requestingUrl: 'https://riunione.example/' });
    await attendi();
    const domanda = ses.avvisi.filter((a) => a.evento === 'chiedi' && a.dati.tipo === 'schermo').at(-1);
    Permessi.rispondi(domanda.dati.id, true, 'screen:1:0');
    return { esiti, consegne };
  };
  assert.deepEqual(await presenta('https://pubblicita.example/riquadro'), { esiti: [true], consegne: [{ video: sorgente }] },
    'l\'avviso di un riquadro di un altro sito non tocca la presentazione della pagina');
  assert.deepEqual(await presenta('https://riunione.example/'), { esiti: [false], consegne: [] }, 'quello della pagina stessa sì');
  assert.equal(wc.fermata, undefined, 'e la pagina resta viva');
  assert.deepEqual(await presenta(null), { esiti: [true], consegne: [{ video: sorgente }] }, 'l\'avviso vale una domanda sola');
});

test('un riquadro di un altro sito non chiede le notifiche col nome di chi lo ospita e non ne eredita il sì', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://giornale.example/articolo');
  Permessi.seguiGesti(wc);
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  const esiti = chiedi(ses, wc, 'notifications');
  Permessi.rispondi(ses.avvisi.find((a) => a.evento === 'chiedi').dati.id, true);
  assert.deepEqual(esiti, [true]);
  const riquadro = { isMainFrame: false, requestingUrl: 'https://pubblicita.example/banner' };
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  assert.deepEqual(chiedi(ses, wc, 'notifications', riquadro), [false], 'nessuna domanda col nome del giornale');
  assert.equal(ses.avvisi.filter((a) => a.evento === 'chiedi').length, 1);
  assert.equal(ses.controllo(wc, 'notifications', 'https://pubblicita.example', riquadro), false, 'il sì del giornale non vale per il riquadro');
  const stesso = { isMainFrame: false, requestingUrl: 'https://giornale.example/commenti' };
  assert.equal(ses.controllo(wc, 'notifications', 'https://giornale.example', stesso), true, 'un riquadro del sito stesso sì');
});

test('il segno sulla scheda: cosa la pagina usa, cosa si è vista negare, e una pagina nuova riparte da zero', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://riunione.example/');
  assert.equal(Permessi.segniDi(wc), null);
  const esiti = chiedi(ses, wc, 'media', { mediaTypes: ['audio', 'video'] });
  Permessi.rispondi(ses.avvisi.find((a) => a.evento === 'chiedi').dati.id, true);
  assert.deepEqual(esiti, [true]);
  assert.deepEqual(Permessi.segniDi(wc), { usati: ['audio', 'video'], negati: [] });
  const altro = wcFinto('https://mappe.example/');
  const e2 = chiedi(ses, altro, 'geolocation');
  Permessi.rispondi(ses.avvisi.filter((a) => a.evento === 'chiedi').at(-1).dati.id, false);
  assert.deepEqual(e2, [false]);
  assert.deepEqual(Permessi.segniDi(altro), { usati: [], negati: ['posizione'] });
  assert.deepEqual(chiedi(ses, altro, 'geolocation'), [false], 'il no salvato resta, e il segno lo dice ancora');
  assert.deepEqual(Permessi.segniDi(altro), { usati: [], negati: ['posizione'] });
  wc.emetti('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.equal(Permessi.segniDi(wc), null, 'la pagina nuova non ha ancora niente');
});
