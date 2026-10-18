// #975 — il menu che un sito si disegna da sé: chi ascolta il tasto destro lo sa la sonda nel mondo della pagina
// (qui girata nel processo dei test, con la finestra come unico nodo del cammino), la scelta per sito sta in
// menuDelSito.siti e arriva solo al sito che la riguarda, la proposta parte una volta alla terza scelta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'nomiSito.js'));
require(join(ROOT, 'src', 'shared', 'preferences.js'));
const P = globalThis.SN_PREF;
require(join(ROOT, 'src', 'shared', 'cambi.js'));
const K = globalThis.SN_CAMBI;
const W = require(join(ROOT, 'src', 'main', 'services', 'impostazioniPerOrigine.js'));
const M = require(join(ROOT, 'src', 'main', 'services', 'menuDelSito.js'));
const { sorgenteSonda } = require(join(ROOT, 'src', 'preload', 'menu-del-sito.js'));

// La sonda gira una volta sola per processo, come in una pagina: dopo, addEventListener è la sua.
const NOME = 'provasonda';
const finestra = new EventTarget();
globalThis.window = finestra;
const nativoAdd = EventTarget.prototype.addEventListener;
vm.runInThisContext(sorgenteSonda(NOME));

const chiedi = (suffisso, nodo = finestra) => !nodo.dispatchEvent(new Event(NOME + suffisso, { cancelable: true }));
const ascolta = () => chiedi(':c');
const pulisci = () => { for (const k of Object.keys(finestra)) delete finestra[k]; };

test('la sostituta di addEventListener sembra nativa a chi la ispeziona', () => {
  const add = EventTarget.prototype.addEventListener;
  assert.notEqual(add, nativoAdd);
  assert.equal(add.toString(), 'function addEventListener() { [native code] }');
  assert.equal(Function.prototype.toString.call(add), 'function addEventListener() { [native code] }');
  assert.equal(Function.prototype.toString.toString(), 'function toString() { [native code] }');
  assert.equal(add.name, 'addEventListener');
  assert.equal(add.length, nativoAdd.length);
  assert.equal(add.prototype, undefined);
  assert.throws(() => new add('x', () => {}), TypeError);
  assert.equal(EventTarget.prototype.removeEventListener.toString(), 'function removeEventListener() { [native code] }');
});

test('chi si iscrive a contextmenu si vede finché non si toglie, per fase; gli altri eventi no', () => {
  const f = () => {};
  finestra.addEventListener('click', f);
  assert.equal(ascolta(), false);
  finestra.addEventListener('contextmenu', f, true);
  assert.equal(ascolta(), true);
  finestra.removeEventListener('contextmenu', f);
  assert.equal(ascolta(), true, 'tolto in bolla, ma era iscritto in cattura');
  finestra.removeEventListener('contextmenu', f, { capture: true });
  assert.equal(ascolta(), false);
  // L'evento arriva comunque all'ascoltatore vero: la sonda segna, non sostituisce.
  let arrivato = 0;
  const g = () => { arrivato += 1; };
  finestra.addEventListener('contextmenu', g);
  finestra.dispatchEvent(new Event('contextmenu'));
  assert.equal(arrivato, 1);
  finestra.removeEventListener('contextmenu', g);
  assert.equal(ascolta(), false);
});

test('un ascoltatore legato a un segnale smette di contare quando il segnale scatta', () => {
  const ac = new AbortController();
  finestra.addEventListener('contextmenu', () => {}, { signal: ac.signal });
  assert.equal(ascolta(), true);
  ac.abort();
  assert.equal(ascolta(), false);
  const gia = new AbortController();
  gia.abort();
  finestra.addEventListener('contextmenu', () => {}, { signal: gia.signal });
  assert.equal(ascolta(), false, 'con un segnale già scattato il browser non lo iscrive');
});

test('la radice di React ascolta tutto: conta solo con un onContextMenu sul cammino', () => {
  const f = () => {};
  finestra.addEventListener('contextmenu', f);
  try {
    finestra.nodeType = 1;
    finestra._reactListening9k2 = true;
    assert.equal(ascolta(), false);
    finestra.__reactProps$9k2 = { onClick() {} };
    assert.equal(ascolta(), false);
    finestra.__reactProps$9k2 = { onContextMenu() {} };
    assert.equal(ascolta(), true);
  } finally {
    pulisci();
    finestra.removeEventListener('contextmenu', f);
  }
});

test('lo stesso ascoltatore sulla finestra per tanti eventi guarda i clic, non apre menu; uno suo accanto conta', () => {
  const tutti = (e) => e;
  const tipi = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'auxclick', 'dblclick', 'contextmenu', 'touchstart'];
  for (const t of tipi) finestra.addEventListener(t, tutti, true);
  assert.equal(ascolta(), false);
  const suo = () => {};
  finestra.addEventListener('contextmenu', suo);
  assert.equal(ascolta(), true);
  finestra.removeEventListener('contextmenu', suo);
  for (const t of tipi) finestra.removeEventListener(t, tutti, true);
  // Pochi eventi con lo stesso ascoltatore restano un ascolto vero.
  const tela = (e) => e;
  for (const t of ['pointerdown', 'pointerup', 'contextmenu']) finestra.addEventListener(t, tela);
  assert.equal(ascolta(), true);
  for (const t of ['pointerdown', 'pointerup', 'contextmenu']) finestra.removeEventListener(t, tela);
});

test('conta anche il gestore oncontextmenu, finché c\'è', () => {
  assert.equal(ascolta(), false);
  finestra.oncontextmenu = () => false;
  assert.equal(ascolta(), true);
  finestra.oncontextmenu = null;
  assert.equal(ascolta(), false);
  Object.defineProperty(finestra, 'oncontextmenu', { configurable: true, get() { throw new Error('no'); } });
  assert.equal(ascolta(), false);
  pulisci();
});

test('chi ascoltava e non ha mostrato niente non conta più, e il segreto non lo indovina chi non lo sa', () => {
  const f = () => {};
  finestra.addEventListener('contextmenu', f);
  assert.equal(ascolta(), true);
  assert.equal(!finestra.dispatchEvent(new Event('altronome:c', { cancelable: true })), false);
  chiedi(':f');
  assert.equal(ascolta(), false);
  finestra.removeEventListener('contextmenu', f);
});

test('il sito di chi parla: http(s), senza www, e mai un nome che non è un host', () => {
  assert.equal(M.sitoDi('https://www.Figma.com/file/abc'), 'figma.com');
  assert.equal(M.sitoDi('https://docs.google.com/document/d/1'), 'docs.google.com');
  assert.equal(M.sitoDi('http://127.0.0.1:8080/x'), '127.0.0.1');
  assert.equal(M.sitoDi('http://[::1]:3000/'), '[::1]');
  for (const no of ['filo://preferences/preferences.html', 'file:///C:/x.html', 'about:blank', '', null, 'javascript:alert(1)']) {
    assert.equal(M.sitoDi(no), '', String(no));
  }
  assert.equal(M.normalizza('__proto__'), '');
  assert.equal(M.normalizza('a b.com'), '');
  assert.equal(M.normalizza(`${'a'.repeat(250)}.com`), '');
});

test('l\'elenco copre il sito e i suoi sottodomini; togliere libera il sito da ogni voce che lo copre', () => {
  assert.equal(M.nellElenco(['google.com'], 'docs.google.com'), true);
  assert.equal(M.nellElenco(['docs.google.com'], 'google.com'), false);
  assert.equal(M.nellElenco(['gle.com'], 'google.com'), false);
  assert.deepEqual(M.elencoNuovo([], 'figma.com', true), ['figma.com']);
  assert.deepEqual(M.elencoNuovo(['figma.com'], 'figma.com', true), ['figma.com']);
  assert.deepEqual(M.elencoNuovo(['google.com', 'figma.com'], 'docs.google.com', false), ['figma.com']);
  assert.deepEqual(M.elencoNuovo(null, 'figma.com', false), []);
});

test('la proposta parte alla terza scelta, una volta sola per sito, e mai dove il menu del sito è già il primo', () => {
  let stato = {};
  const scelte = [];
  for (let i = 0; i < 5; i++) {
    const r = M.conUnaScelta(stato, 'figma.com');
    stato = r.stato;
    scelte.push(r.proponi);
  }
  assert.deepEqual(scelte, [false, false, true, false, false]);
  assert.equal(stato.scelte['figma.com'], 5);
  assert.deepEqual(stato.proposti, ['figma.com']);
  let altro = {};
  for (let i = 0; i < 3; i++) altro = M.conUnaScelta(altro, 'docs.google.com', { giaPrimo: true }).stato;
  assert.deepEqual(altro.proposti, []);
  // Un magazzino sporco non rompe niente e non porta chiavi strane.
  const sporco = M.leggiStato({ scelte: { '__proto__': 9, 'ok.it': '2', 'x y': 3, 'neg.it': -1 }, proposti: ['ok.it', 7, 'ok.it'] });
  assert.deepEqual({ ...sporco.scelte }, { 'ok.it': 2 });
  assert.deepEqual(sporco.proposti, ['ok.it']);
});

test('le scelte si scrivono in fila: due insieme non si cancellano', async () => {
  let salvato = {};
  globalThis.SN_STORAGE = {
    getRaw: async () => { await new Promise((r) => setTimeout(r, 5)); return JSON.parse(JSON.stringify(salvato)); },
    setRaw: async (_k, v) => { salvato = v; },
  };
  const esiti = await Promise.all([M.registraScelta('a.it'), M.registraScelta('a.it'), M.registraScelta('a.it')]);
  assert.deepEqual(esiti, [false, false, true]);
  assert.equal(salvato.scelte['a.it'], 3);
});

test('a un sito arriva solo la sua voce dell\'elenco, come per i siti esclusi', () => {
  const s = JSON.parse(JSON.stringify(globalThis.SN_CONST.DEFAULT_SETTINGS));
  s.menuDelSito = { siti: ['figma.com', 'docs.google.com', 'altro.it'] };
  const perFigma = W.impostazioniPerOrigine(s, 'https://www.figma.com/file/1');
  assert.deepEqual(perFigma.menuDelSito, { siti: ['figma.com'] });
  const perNessuno = W.impostazioniPerOrigine(s, 'https://esempio.it/');
  assert.deepEqual(perNessuno.menuDelSito, { siti: [] });
  assert.deepEqual(s.menuDelSito.siti, ['figma.com', 'docs.google.com', 'altro.it'], 'l\'originale non si tocca');
  assert.deepEqual(W.impostazioniPerOrigine(s, 'filo://preferences/preferences.html').menuDelSito.siti, s.menuDelSito.siti);
});

test('dalla chat: aggiungi e togli un sito, costo 1 come l\'annullo, e «questo sito» passa dalla risoluzione delle schede', () => {
  const add = P.buildPreferencePartial('menu_del_sito', 'aggiungi figma.com');
  assert.deepEqual(add.partial, { menuDelSito: { siti: ['figma.com'] } });
  const r = P.applicaElenco(add.elenco, { menuDelSito: { siti: ['docs.google.com'] } });
  assert.deepEqual(r.lista, ['docs.google.com', 'figma.com']);
  const via = P.buildPreferencePartial('menu del sito', 'togli docs.google.com');
  assert.deepEqual(P.applicaElenco(via.elenco, { menuDelSito: { siti: ['docs.google.com', 'figma.com'] } }).lista, ['figma.com']);
  const s = P.setterDi('menuDelSito.siti');
  assert.equal(s.costo, 1);
  assert.equal(K.voce('menuDelSito.siti').livello, 1);
  const fs = require('node:fs');
  const handlers = fs.readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers.js'), 'utf8');
  assert.match(handlers, /setter\.scrive\.includes\('menuDelSito\.siti'\)/);
});
