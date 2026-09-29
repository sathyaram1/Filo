// Permessi delle pagine web (#591.1): microfono, fotocamera, appunti e posizione passano da un sì dell'utente;
// Filo stesso e i suoi lasciapassare no; la finestra nascosta del controllo profondo dice no a tutto.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: ['video'] }), [], 'né la fotocamera');
    assert.equal(ses.controllo(wc, 'media', 'https://posta.example', { mediaType: 'video' }), true, 'finché nessuno ha detto no');
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
  const tipi = { midiSysex: 'strumenti', 'idle-detection': 'presenza', 'window-management': 'schermi' };
  for (const [p, tipo] of Object.entries(tipi)) {
    assert.deepEqual(chiedi(ses, wc, p), [], p);
    assert.equal(ses.avvisi.at(-1).dati.tipo, tipo, p);
  }
  assert.equal(ses.controllo(wc, 'idle-detection', 'https://video.example', {}), false, 'chi sa che sei al computer lo sa solo col sì');
  for (const p of ['display-capture', 'unknown', 'hid', 'serial', 'usb']) {
    assert.deepEqual(chiedi(ses, wc, p), [false], p);
    assert.equal(ses.controllo(wc, p, 'https://video.example', {}), false, p);
  }
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: [] }), [false], 'condividere lo schermo: niente domanda su microfono e fotocamera');
});

test('i font del computer, che Electron non fa chiedere, passano solo subito dopo un gesto sulla pagina', () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://grafica.example/');
  Permessi.seguiGesti(wc);
  assert.equal(ses.controllo(wc, 'local-fonts', 'https://grafica.example', {}), false);
  wc.emetti('input-event', {}, { type: 'mouseDown' });
  assert.equal(ses.controllo(wc, 'local-fonts', 'https://grafica.example', {}), true);
});

// Un riquadro di un altro sito non passa da `input-event`: il tasto destro e i tasti sì (#589.1).
test('il gesto arriva anche dal tasto destro e dai tasti dentro un riquadro', () => {
  const tasto = wcFinto('https://blog.example/');
  Permessi.seguiGesti(tasto);
  tasto.emetti('before-input-event', {}, { type: 'keyUp', key: 'a' });
  tasto.emetti('before-input-event', {}, { type: 'keyDown', key: 'Escape' });
  assert.equal(Permessi.gestoPerFilo(tasto), false, 'un tasto lasciato o Esc non sono un gesto');
  tasto.emetti('before-input-event', {}, { type: 'keyDown', key: 'a' });
  assert.equal(Permessi.gestoPerFilo(tasto), true);
  const destro = wcFinto('https://blog.example/');
  Permessi.seguiGesti(destro);
  destro.emetti('context-menu', {}, {});
  assert.equal(Permessi.gestoPerFilo(destro), true);
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

// Ogni nome che Electron può mandare ai gestori ha una regola: un nome nuovo, qui, è un rosso e non un no silenzioso.
test('ogni permesso che Electron dichiara è chiesto, concesso o negato per una ragione scritta', () => {
  const dts = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'electron', 'electron.d.ts'), 'utf8');
  const nomi = new Set();
  for (const firma of ['setPermissionRequestHandler(handler: ((webContents: WebContents, permission: ',
    'setPermissionCheckHandler(handler: ((webContents: (WebContents) | (null), permission: ']) {
    const i = dts.indexOf(firma);
    assert.ok(i >= 0, firma);
    const union = dts.slice(i + firma.length, dts.indexOf(', ', i + firma.length));
    for (const m of union.matchAll(/'([^']+)'/g)) nomi.add(m[1]);
  }
  assert.ok(nomi.size > 15);
  const regole = new Set([...Object.keys(Permessi.TIPI), ...Permessi.INNOCUI, ...Permessi.NON_DISPONIBILI,
    ...Permessi.COL_GESTO_SENZA_DOMANDA, 'openExternal']);
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
  const chrome = ['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write', 'mediaKeySystem', 'midi',
    'speaker-selection', 'screen-wake-lock', 'background-sync', 'background-fetch', 'sensors', 'payment-handler',
    'persistent-storage'];
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
