// #870 — le carte della home: catalogo, disposizione salvata e mosse (src/shared/carteHome.js), la fila delle
// scritture nel main (src/main/services/carteHome.js) e i canali che le portano. Senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'carteHome.js'));
require(join(ROOT, 'src', 'shared', 'actionTools.js'));
require(join(ROOT, 'src', 'shared', 'actionLevels.js'));

const C = globalThis.SN_CARTE_HOME;
const ordine = (l) => l.destra.join(',');

test('chi non ha ancora spostato niente vede tutte le carte, Editor sopra i Mazzi', () => {
  const l = C.normalizza(null);
  assert.deepEqual(l.destra, ['editor', 'mazzi', 'suggerimenti', 'rapide']);
  assert.deepEqual(l.tolte, []);
  assert.deepEqual(C.normalizza('rotta'), l);
});

test('una carta nuova del catalogo compare in fondo a chi aveva già salvato; tolte restano solo le sue', () => {
  const l = C.normalizza({ destra: ['rapide', 'editor', 'sconosciuta'], tolte: ['mazzi', 'boh'] });
  assert.equal(ordine(l), 'rapide,editor,suggerimenti');
  assert.deepEqual(l.tolte, ['mazzi']);
  const doppia = C.normalizza({ destra: ['editor', 'editor'], tolte: ['editor'] });
  assert.ok(!doppia.destra.includes('editor'), 'una carta tolta non resta anche a destra');
});

test('trascinare i Mazzi sopra l’Editor li scambia', () => {
  const r = C.applica(C.predefinita(), { tipo: 'sposta', carta: 'mazzi', prima: 'editor' });
  assert.equal(r.cambiato, true);
  assert.equal(ordine(r.layout), 'mazzi,editor,suggerimenti,rapide');
});

test('sposta su, giù, in cima e in fondo; ai bordi non si muove', () => {
  const p = C.predefinita();
  assert.equal(ordine(C.applica(p, { tipo: 'sposta', carta: 'suggerimenti', verso: 'su' }).layout), 'editor,suggerimenti,mazzi,rapide');
  assert.equal(ordine(C.applica(p, { tipo: 'sposta', carta: 'editor', verso: 'giu' }).layout), 'mazzi,editor,suggerimenti,rapide');
  assert.equal(ordine(C.applica(p, { tipo: 'sposta', carta: 'rapide', verso: 'cima' }).layout), 'rapide,editor,mazzi,suggerimenti');
  assert.equal(ordine(C.applica(p, { tipo: 'sposta', carta: 'editor', verso: 'fondo' }).layout), 'mazzi,suggerimenti,rapide,editor');
  const fermo = C.applica(p, { tipo: 'sposta', carta: 'editor', verso: 'su' });
  assert.equal(fermo.cambiato, false);
  assert.equal(C.applica(p, { tipo: 'sposta', carta: 'rapide', verso: 'giu' }).cambiato, false);
});

test('togliere manda la carta in «altro», rimetterla la riporta (in fondo, in cima o davanti a una)', () => {
  const tolta = C.applica(C.predefinita(), { tipo: 'togli', carta: 'mazzi' }).layout;
  assert.equal(ordine(tolta), 'editor,suggerimenti,rapide');
  assert.deepEqual(tolta.tolte, ['mazzi']);
  assert.deepEqual(C.descrivi(tolta), { destra: ['Editor', 'Filo ti suggerisce', 'Impostazioni rapide'], altro: ['Mazzi'] });
  assert.equal(ordine(C.applica(tolta, { tipo: 'aggiungi', carta: 'mazzi' }).layout), 'editor,suggerimenti,rapide,mazzi');
  assert.equal(ordine(C.applica(tolta, { tipo: 'aggiungi', carta: 'mazzi', verso: 'cima' }).layout), 'mazzi,editor,suggerimenti,rapide');
  const davanti = C.applica(tolta, { tipo: 'aggiungi', carta: 'mazzi', prima: 'rapide' }).layout;
  assert.equal(ordine(davanti), 'editor,suggerimenti,mazzi,rapide');
  assert.deepEqual(davanti.tolte, []);
});

test('una mossa impossibile lo dice e non cambia niente', () => {
  const p = C.predefinita();
  for (const m of [{ tipo: 'togli', carta: 'posta' }, { tipo: 'sposta' }, { tipo: 'vola', carta: 'editor' }, null,
    { tipo: 'sposta', carta: 'editor', verso: 'a destra' }, { tipo: 'nascondi' }, { tipo: 'ordina-sinistra', ordine: [] }]) {
    const r = C.applica(p, m);
    assert.ok(r.errore, JSON.stringify(m));
    assert.equal(r.cambiato, false);
    assert.deepEqual(r.layout, p);
  }
  const tolta = C.applica(p, { tipo: 'togli', carta: 'mazzi' }).layout;
  assert.match(C.applica(tolta, { tipo: 'sposta', carta: 'mazzi', verso: 'su' }).errore, /rimessa/);
  assert.equal(C.applica(tolta, { tipo: 'togli', carta: 'mazzi' }).cambiato, false);
});

test('il nome come lo dice l’utente porta alla carta giusta', () => {
  assert.equal(C.risolvi('la carta dei mazzi'), 'mazzi');
  assert.equal(C.risolvi('carta dell’editor'.replace('’', "'")), 'editor');
  assert.equal(C.risolvi('Filo ti suggerisce'), 'suggerimenti');
  assert.equal(C.risolvi('Impostazioni rapide'), 'rapide');
  assert.equal(C.risolvi('DECK'), 'mazzi');
  assert.equal(C.risolvi('la posta'), null);
  assert.equal(C.risolvi(''), null);
  assert.equal(ordine(C.applica(C.predefinita(), { tipo: 'togli', carta: 'i suggerimenti' }).layout), 'editor,mazzi,rapide');
});

test('a sinistra: le carte nuove vengono prima, quelle già disposte tengono il posto che ha dato l’utente', () => {
  const l = C.applica(C.predefinita(), { tipo: 'ordina-sinistra', ordine: ['download:1', 'timer:a'] }).layout;
  assert.deepEqual(C.ordinaSinistra(['timer:a', 'avviso:x', 'download:1'], l), ['avviso:x', 'download:1', 'timer:a']);
  assert.deepEqual(C.ordinaSinistra(['timer:a'], C.predefinita()), ['timer:a']);
});

test('nascondere e ripristinare: «come all’inizio» rimette anche le carte di sinistra nascoste', () => {
  let l = C.applica(C.predefinita(), { tipo: 'nascondi', chiave: 'download:7' }).layout;
  l = C.applica(l, { tipo: 'nascondi', chiave: 'crediti' }).layout;
  l = C.applica(l, { tipo: 'togli', carta: 'editor' }).layout;
  assert.deepEqual(l.nascoste, ['download:7', 'crediti']);
  const r = C.applica(l, { tipo: 'ripristina' });
  assert.deepEqual(r.layout, C.predefinita());
});

test('i promemoria di sinistra hanno un tetto e cade il più vecchio', () => {
  const tante = Array.from({ length: C.TETTO_NASCOSTE + 20 }, (_, i) => `download:${i}`);
  const l = C.normalizza({ nascoste: tante });
  assert.equal(l.nascoste.length, C.TETTO_NASCOSTE);
  assert.equal(l.nascoste[l.nascoste.length - 1], `download:${C.TETTO_NASCOSTE + 19}`);
  assert.ok(!l.nascoste.includes('download:0'));
});

test('lo strumento della chat conosce esattamente le carte del catalogo', () => {
  const def = globalThis.SN_ACTION_TOOLS.definitions().find((d) => d.function.name === 'CARTA_HOME');
  assert.ok(def, 'manca lo strumento CARTA_HOME');
  const p = def.function.parameters.properties;
  assert.deepEqual(p.carta.enum, C.IDS);
  assert.deepEqual(p.prima_di.enum, C.IDS);
});

test('l’azione è di livello 1 e la descrizione usa il nome che l’utente vede', () => {
  const L = globalThis.SN_ACTION_LEVELS;
  assert.equal(L.levelFor({ type: 'CARTA_HOME', operazione: 'togli', carta: 'mazzi' }), 1);
  assert.equal(L.describe({ type: 'CARTA_HOME', operazione: 'togli', carta: 'mazzi' }), 'Togliere la carta «Mazzi» dalla home');
  assert.match(L.describeDone({ type: 'CARTA_HOME', operazione: 'togli', carta: 'mazzi' }), /«Mazzi» tolta.*«altro»/);
  assert.match(L.describeDone({ type: 'CARTA_HOME', operazione: 'rimetti', carta: 'suggerimenti' }), /«Filo ti suggerisce» rimessa/);
});

test('due mosse quasi insieme non si cancellano: il main le mette in fila', async () => {
  let salvato = null;
  const attesa = () => new Promise((r) => setTimeout(r, 5));
  globalThis.chrome = {
    storage: {
      local: {
        async get(k) { await attesa(); return { [k]: salvato ? JSON.parse(JSON.stringify(salvato)) : undefined }; },
        async set(o) { await attesa(); salvato = Object.values(o)[0]; },
      },
    },
  };
  const S = require(join(ROOT, 'src', 'main', 'services', 'carteHome.js'));
  const [a, b] = await Promise.all([
    S.modifica({ tipo: 'togli', carta: 'mazzi' }),
    S.modifica({ tipo: 'sposta', carta: 'rapide', verso: 'cima' }),
  ]);
  assert.equal(a.cambiato && b.cambiato, true);
  const finale = await S.leggi();
  assert.equal(ordine(finale), 'rapide,editor,suggerimenti');
  assert.deepEqual(finale.tolte, ['mazzi']);
  const fallita = await S.modifica({ tipo: 'togli', carta: 'posta' });
  assert.ok(fallita.errore);
  assert.deepEqual(await S.leggi(), finale);
});

test('i canali delle carte rispondono solo alle pagine di Filo', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers', 'filo.js'), 'utf8');
  for (const tipo of ['CARTE_HOME_GET', 'CARTE_HOME_MODIFICA', 'EDITOR_RECENTI']) {
    assert.match(src, new RegExp(`on\\(MSG\\.${tipo}, soloFilo\\(`), `${tipo} risponde anche a un sito`);
  }
});
