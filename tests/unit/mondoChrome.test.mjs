// Il mondo della pagina come in Chrome (src/preload/mondo-chrome.js, #1616 e #1608): window.chrome pieno con funzioni
// che si presentano native, la richiesta passkey condizionale in sospeso finché il sito non la annulla, «hybrid»
// aggiunto ai trasporti in una copia delle opzioni e mai all'oggetto della pagina.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildSource } = require('../../src/preload/mondo-chrome.js');

const attimo = () => new Promise((r) => setTimeout(r, 40));
const ID = 'abcdefghijklmnopabcdefghijklmnop';

// Una pagina finta: window con un chrome vuoto come in Electron, navigator.credentials col get sul prototipo.
function pagina({ chrome = {}, esito = () => Promise.resolve(null), permesso = true, credenziali = true } = {}) {
  const ricevute = [];
  const ctx = {
    console, setTimeout, clearTimeout, DOMException, AbortController, ricevute, esito,
    performance: { now: () => 1, timing: { domContentLoadedEventEnd: 2, navigationStart: 1, responseStart: 1, loadEventEnd: 3 }, getEntriesByType: () => [] },
    document: { permissionsPolicy: { allowsFeature: (f) => (f === 'publickey-credentials-get' ? permesso : true) } },
  };
  ctx.window = ctx;
  if (chrome !== null) ctx.chrome = chrome;
  vm.createContext(ctx);
  ctx.Function = vm.runInContext('Function', ctx);
  if (credenziali) {
    vm.runInContext(`
      function CredentialsContainer() {}
      CredentialsContainer.prototype.get = function get(options) { ricevute.push({ opts: options, questo: this, n: arguments.length }); return esito(options); };
      var navigator = { credentials: new CredentialsContainer() };
    `, ctx);
    ctx.originale = ctx.CredentialsContainer.prototype.get;
  }
  vm.runInContext(buildSource(), ctx);
  return ctx;
}

const richiesta = (extra = {}) => {
  const idA = new Uint8Array(16);
  return {
    opts: {
      ...extra,
      publicKey: {
        challenge: new Uint8Array(32), rpId: 'google.com', userVerification: 'required',
        allowCredentials: [
          { type: 'public-key', id: idA, transports: ['internal'] },
          { type: 'public-key', id: new Uint8Array(8), transports: ['internal', 'hybrid'] },
          { type: 'public-key', id: new Uint8Array(8), transports: ['internal', 'cable'] },
          { type: 'public-key', id: new Uint8Array(8), transports: ['usb'] },
          { type: 'public-key', id: new Uint8Array(8), transports: [] },
          { type: 'public-key', id: new Uint8Array(8) },
        ],
      },
    },
    idA,
  };
};

test('un window.chrome vuoto si riempie come in Chrome, sullo stesso oggetto', () => {
  const vuoto = {};
  const { chrome } = pagina({ chrome: vuoto });
  assert.equal(chrome, vuoto, 'si riempie l\'oggetto che c\'è, non se ne crea un altro');
  assert.equal(chrome.app.isInstalled, false);
  assert.equal(chrome.app.getIsInstalled(), false);
  assert.equal(chrome.app.runningState(), 'cannot_run');
  assert.equal(chrome.runtime.PlatformOs.WIN, 'win');
  assert.equal(chrome.runtime.OnInstalledReason.INSTALL, 'install');
  assert.equal(typeof chrome.csi().pageT, 'number');
  assert.equal(chrome.loadTimes().navigationType, 'Other');
});

test('runtime.connect e sendMessage: senza id l\'errore di Chrome, con un id nessuna eccezione e la callback dopo', async () => {
  const { chrome } = pagina();
  assert.throws(() => chrome.runtime.connect(), { name: 'TypeError', message: /chrome\.runtime\.connect\(\) called from a webpage must specify an Extension ID/ });
  assert.throws(() => chrome.runtime.sendMessage({ ciao: 1 }), { name: 'TypeError', message: /chrome\.runtime\.sendMessage\(\) called from a webpage must specify an Extension ID/ });
  const porta = chrome.runtime.connect(ID, { name: 'canale' });
  assert.equal(porta.name, 'canale');
  assert.equal(typeof porta.postMessage, 'function');
  porta.postMessage({ x: 1 });
  const chiusaCon = await new Promise((r) => porta.onDisconnect.addListener(r));
  assert.equal(chiusaCon, porta, 'la porta si chiude da sola, dopo, come con un\'estensione che non c\'è');
  let risposta = 'mai';
  assert.equal(chrome.runtime.sendMessage(ID, { x: 1 }, (v) => { risposta = v; }), undefined);
  assert.equal(risposta, 'mai', 'la callback arriva dopo, non durante la chiamata');
  await attimo();
  assert.equal(risposta, undefined);
  assert.equal(chrome.runtime.sendMessage(ID, { x: 1 }), undefined);
});

test('le funzioni di Filo si presentano native, a chi le stampa e a chi usa Function.prototype.toString', () => {
  const ctx = pagina();
  const { chrome } = ctx;
  assert.equal(String(chrome.runtime.connect), 'function connect() { [native code] }');
  assert.equal(chrome.runtime.connect.name, 'connect');
  assert.equal(chrome.runtime.connect.length, 0);
  assert.equal(ctx.Function.prototype.toString.call(chrome.app.getDetails), 'function getDetails() { [native code] }');
  assert.equal(String(ctx.Function.prototype.toString), 'function toString() { [native code] }');
  const get = ctx.CredentialsContainer.prototype.get;
  assert.notEqual(get, ctx.originale);
  assert.equal(String(get), String(ctx.originale), 'il get avvolto stampa lo stesso testo dell\'originale');
  assert.equal(get.name, 'get');
  assert.equal(get.length, ctx.originale.length);
  assert.equal(Object.prototype.hasOwnProperty.call(ctx.navigator.credentials, 'get'), false, 'la patch sta sul prototipo, non sull\'istanza');
  const d = Object.getOwnPropertyDescriptor(ctx.CredentialsContainer.prototype, 'get');
  assert.deepEqual({ w: d.writable, e: d.enumerable, c: d.configurable }, { w: true, e: true, c: true });
  assert.equal(String(vm.runInContext('(function ciao(a) { return a; })', ctx)), 'function ciao(a) { return a; }', 'le altre funzioni stampano il loro testo');
});

test('un window.chrome già pieno (Chrome vero) non si tocca; senza window.chrome se ne crea uno', () => {
  const pieno = pagina({ chrome: { runtime: { segno: 1 } } }).chrome;
  assert.equal(pieno.runtime.segno, 1);
  assert.equal(pieno.app, undefined);
  const creato = pagina({ chrome: null });
  assert.equal(typeof creato.chrome.runtime.connect, 'function');
  assert.equal(Object.getOwnPropertyDescriptor(creato, 'chrome').configurable, true);
});

test('la richiesta condizionale resta in sospeso e l\'originale non parte; il sito la annulla con AbortError', async () => {
  const ctx = pagina();
  const ac = new AbortController();
  const p = ctx.navigator.credentials.get({ mediation: 'conditional', signal: ac.signal, ...richiesta().opts });
  const esito = await Promise.race([p.then(() => 'risolta', (e) => `respinta ${e.name}`), attimo().then(() => 'in sospeso')]);
  assert.equal(esito, 'in sospeso');
  assert.equal(ctx.ricevute.length, 0);
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');

  const mio = new Error('basta');
  const ac2 = new AbortController();
  const p2 = ctx.navigator.credentials.get({ mediation: 'conditional', signal: ac2.signal, ...richiesta().opts });
  ac2.abort(mio);
  await assert.rejects(p2, (e) => e === mio, 'il motivo dell\'annullamento è quello del sito');

  const ac3 = new AbortController();
  ac3.abort();
  await assert.rejects(ctx.navigator.credentials.get({ mediation: 'conditional', signal: ac3.signal, ...richiesta().opts }), (e) => e.name === 'AbortError');

  // Un segnale senza motivo (un polyfill): l'errore è comunque un AbortError.
  let scatta = null;
  const finto = { aborted: false, addEventListener: (_t, fn) => { scatta = fn; } };
  const p4 = ctx.navigator.credentials.get({ mediation: 'conditional', signal: finto, ...richiesta().opts });
  scatta();
  await assert.rejects(p4, (e) => e.name === 'AbortError' && e instanceof DOMException);

  const senzaSegnale = ctx.navigator.credentials.get({ mediation: 'conditional', ...richiesta().opts });
  assert.equal(await Promise.race([senzaSegnale.then(() => 'risolta', () => 'respinta'), attimo().then(() => 'in sospeso')]), 'in sospeso');
  assert.equal(ctx.ricevute.length, 0);
});

test('condizionale senza passkey, o dove la pagina non ha il permesso delle passkey, passa all\'originale', async () => {
  const ctx = pagina({ esito: () => Promise.resolve('cred') });
  assert.equal(await ctx.navigator.credentials.get({ mediation: 'conditional', password: true }), 'cred');
  assert.equal(ctx.ricevute.length, 1);
  const negata = pagina({ permesso: false, esito: () => Promise.resolve('cred') });
  assert.equal(await negata.navigator.credentials.get({ mediation: 'conditional', ...richiesta().opts }), 'cred');
  assert.equal(negata.ricevute.length, 1);
});

test('«hybrid» entra nei trasporti di chi ha solo «internal», in una copia: l\'oggetto della pagina resta intatto', async () => {
  const cred = { type: 'public-key', id: 'x' };
  const ctx = pagina({ esito: () => Promise.resolve(cred) });
  const { opts, idA } = richiesta({ mediation: 'optional' });
  const foto = JSON.stringify(opts.publicKey.allowCredentials.map((c) => c.transports));
  assert.equal(await ctx.navigator.credentials.get(opts), cred, 'l\'esito dell\'originale arriva alla pagina');
  const [arrivata] = ctx.ricevute;
  assert.notEqual(arrivata.opts, opts);
  assert.equal(arrivata.questo, ctx.navigator.credentials);
  const lista = arrivata.opts.publicKey.allowCredentials;
  assert.deepEqual(lista[0].transports, ['internal', 'hybrid']);
  assert.equal(lista[0].id, idA, 'l\'id della credenziale è lo stesso oggetto, non una copia');
  assert.equal(lista[0].type, 'public-key');
  for (const i of [1, 2, 3, 4, 5]) assert.equal(lista[i], opts.publicKey.allowCredentials[i], `la credenziale ${i} non cambia`);
  assert.equal(arrivata.opts.mediation, 'optional');
  assert.equal(arrivata.opts.publicKey.challenge, opts.publicKey.challenge);
  assert.equal(JSON.stringify(opts.publicKey.allowCredentials.map((c) => c.transports)), foto, 'l\'oggetto della pagina non si tocca');
  assert.deepEqual(opts.publicKey.allowCredentials[0].transports, ['internal']);

  const errore = Object.assign(new Error('no'), { name: 'NotAllowedError' });
  const rossa = pagina({ esito: () => Promise.reject(errore) });
  await assert.rejects(rossa.navigator.credentials.get(richiesta().opts), errore);
});

test('senza niente da completare le opzioni passano come sono; get() senza argomenti e le altre richieste pure', async () => {
  const ctx = pagina();
  const soloUsb = { publicKey: { challenge: new Uint8Array(32), allowCredentials: [{ type: 'public-key', id: new Uint8Array(8), transports: ['usb'] }] } };
  await ctx.navigator.credentials.get(soloUsb);
  assert.equal(ctx.ricevute[0].opts, soloUsb);
  const nonArray = { publicKey: { challenge: new Uint8Array(32), allowCredentials: 'boh' } };
  await ctx.navigator.credentials.get(nonArray);
  assert.equal(ctx.ricevute[1].opts, nonArray);
  await ctx.navigator.credentials.get();
  assert.equal(ctx.ricevute[2].n, 0);
  const password = { password: true };
  await ctx.navigator.credentials.get(password);
  assert.equal(ctx.ricevute[3].opts, password);
});

test('iniettato due volte nello stesso frame non cambia niente', async () => {
  const ctx = pagina();
  vm.runInContext(buildSource(), ctx);
  const { opts } = richiesta();
  await ctx.navigator.credentials.get(opts);
  assert.deepEqual(ctx.ricevute[0].opts.publicKey.allowCredentials[0].transports, ['internal', 'hybrid']);
  const ac = new AbortController();
  const p = ctx.navigator.credentials.get({ mediation: 'conditional', signal: ac.signal, ...richiesta().opts });
  assert.equal(await Promise.race([p.then(() => 'risolta', () => 'respinta'), attimo().then(() => 'in sospeso')]), 'in sospeso');
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.equal(String(ctx.CredentialsContainer.prototype.get), String(ctx.originale));
  assert.equal(typeof ctx.chrome.runtime.connect, 'function');
});

test('in una pagina senza CredentialsContainer riempie window.chrome e non fa danni', () => {
  const ctx = pagina({ credenziali: false });
  assert.equal(typeof ctx.chrome.runtime.sendMessage, 'function');
});
