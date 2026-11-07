// #1974 — la guardia del preload nei frame di YouTube: quando dice che il blocco non regge (video fermo, salto alla fine,
// avviso di YouTube) e quando no (pubblicità in corso, gesto dell'utente, scheda dietro, video in pausa).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { guarda, avvia, AVVISO } = require('../../src/preload/youtube-guardia.js');

function mondo() {
  const ascolti = {};
  const timer = [];
  const avvisi = [];
  let osservatore = null;
  const doc = {
    visibilityState: 'visible',
    addEventListener: (t, f) => { (ascolti[t] = ascolti[t] || []).push(f); },
    removeEventListener: (t, f) => { ascolti[t] = (ascolti[t] || []).filter((x) => x !== f); },
    getElementsByTagName: (n) => (n === AVVISO ? avvisi : []),
  };
  let adesso = 1000;
  const w = {
    document: doc,
    addEventListener: (t, f) => { (ascolti['w:' + t] = ascolti['w:' + t] || []).push(f); },
    setTimeout: (fn, ms) => { timer.push({ fn, ms }); },
    MutationObserver: class { constructor(cb) { osservatore = cb; } observe() {} disconnect() {} },
  };
  const detti = [];
  guarda({ window: w, segnala: (m) => detti.push(m), partenzaMs: 50, ora: () => adesso });
  const emetti = (tipo, target) => (ascolti[tipo] || []).slice().forEach((f) => f({ target, isTrusted: true }));
  return {
    doc, detti, avvisi,
    emetti,
    gesto: () => (ascolti['w:pointerdown'] || []).forEach((f) => f({ isTrusted: true })),
    scorri: (ms) => { adesso += ms; },
    timer: () => { const t = timer.splice(0); t.forEach((x) => x.fn()); return t.length; },
    muta: () => osservatore && osservatore(),
  };
}

const video = (o = {}) => ({ tagName: 'VIDEO', currentTime: 0, duration: 600, paused: false, ended: false, isConnected: true, closest: () => null, ...o });

test('un video che dopo il play resta fermo è un blocco che non regge', () => {
  const m = mondo();
  const v = video();
  m.emetti('play', v);
  m.scorri(60);
  m.timer();
  assert.deepEqual(m.detti, ['fermo']);
});

test('un video che va avanti, è in pausa o mostra una pubblicità non dice niente', () => {
  for (const caso of [{ avanza: true }, { paused: true }, { pubblicita: true }]) {
    const m = mondo();
    const v = video({ paused: !!caso.paused, closest: () => (caso.pubblicita ? {} : null) });
    m.emetti('play', v);
    if (caso.avanza) v.currentTime = 3;
    m.scorri(60);
    m.timer();
    assert.deepEqual(m.detti, [], JSON.stringify(caso));
  }
});

test('una scheda dietro aspetta di tornare davanti prima di contare', () => {
  const m = mondo();
  const v = video();
  m.doc.visibilityState = 'hidden';
  m.emetti('play', v);
  m.scorri(60);
  m.timer();
  assert.deepEqual(m.detti, []);
  m.doc.visibilityState = 'visible';
  m.emetti('visibilitychange', m.doc);
  m.scorri(60);
  assert.equal(m.timer(), 1, 'riparte a contare');
  assert.deepEqual(m.detti, ['fermo']);
});

test('il video mandato alla fine appena partito è un blocco che non regge; un salto dell\'utente no', () => {
  const m = mondo();
  const v = video();
  m.emetti('playing', v);
  m.scorri(1000);
  v.currentTime = 599.5;
  m.emetti('timeupdate', v);
  assert.deepEqual(m.detti, ['fine']);

  const u = mondo();
  const v2 = video();
  u.emetti('playing', v2);
  u.scorri(1000);
  u.gesto();
  v2.currentTime = 599.5;
  u.emetti('timeupdate', v2);
  assert.deepEqual(u.detti, []);

  const lungo = mondo();
  const v3 = video();
  lungo.emetti('playing', v3);
  lungo.scorri(60000);
  v3.currentTime = 599.5;
  lungo.emetti('ended', v3);
  assert.deepEqual(lungo.detti, [], 'un video guardato fino alla fine finisce e basta');
});

test('un video aperto a pochi secondi dalla fine ci arriva da sé: non è un blocco rotto', () => {
  const m = mondo();
  const v = video({ duration: 60, currentTime: 57 });
  m.emetti('playing', v);
  m.scorri(3000);
  v.currentTime = 59.5;
  m.emetti('timeupdate', v);
  v.currentTime = 60;
  m.emetti('ended', v);
  assert.deepEqual(m.detti, []);

  const saltato = mondo();
  const v2 = video({ duration: 600, currentTime: 120 });
  saltato.emetti('playing', v2);
  saltato.scorri(1000);
  v2.currentTime = 599.5;
  saltato.emetti('timeupdate', v2);
  assert.deepEqual(saltato.detti, ['fine'], 'partito a metà e mandato alla fine sì');
});

test('senza regole il frame aspetta: quando il main dice che ce ne sono di nuove le chiede e le esegue, una volta', () => {
  const R = require('../../src/main/services/regoleYouTube.js');
  const ascolti = {};
  let risposta = [];
  const chieste = [];
  const eseguiti = [];
  const ipcRenderer = {
    sendSync: (canale, href) => { chieste.push(href); return risposta; },
    send() {},
    on: (c, f) => { (ascolti[c] = ascolti[c] || []).push(f); },
    removeListener: (c, f) => { ascolti[c] = (ascolti[c] || []).filter((x) => x !== f); },
  };
  const webFrame = { executeJavaScript: (src) => { eseguiti.push(src); return Promise.resolve(); } };
  const { window: w } = (() => {
    const doc = { addEventListener() {}, removeEventListener() {}, getElementsByTagName: () => [] };
    return { window: { document: doc, location: { href: 'https://www.youtube.com/watch?v=dopo' }, addEventListener() {}, setTimeout() {}, MutationObserver: class { observe() {} disconnect() {} } } };
  })();
  const pronte = () => (ascolti[R.CANALE_PRONTE] || []).slice().forEach((f) => f());

  assert.equal(avvia({ ipcRenderer, webFrame, window: w, href: 'https://www.youtube.com/watch?v=primo' }), false);
  assert.equal(eseguiti.length, 0);
  pronte();
  assert.equal(eseguiti.length, 0, 'ancora niente per lui: resta in attesa');
  risposta = [['set', 'ytInitialPlayerResponse.adPlacements', 'undefined']];
  pronte();
  assert.equal(eseguiti.length, 1);
  assert.match(eseguiti[0], /adPlacements/);
  assert.equal(chieste.at(-1), 'https://www.youtube.com/watch?v=dopo', 'le chiede per la pagina di adesso');
  pronte();
  assert.equal(eseguiti.length, 1, 'chi le ha già non le rimette');

  assert.equal(avvia({ ipcRenderer: { ...ipcRenderer, on() { throw new Error('non deve ascoltare'); } }, webFrame, window: w, href: 'https://esempio.it/' }), false);
});

test('l\'avviso di YouTube sui blocchi lo dice subito, una volta sola', () => {
  const m = mondo();
  m.muta();
  assert.deepEqual(m.detti, []);
  m.avvisi.push({});
  m.muta();
  m.muta();
  m.emetti('play', video());
  m.scorri(60);
  m.timer();
  assert.deepEqual(m.detti, ['avviso']);
});
