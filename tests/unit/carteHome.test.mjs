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

test('una carta di sinistra tolta si rimette da sola: la destra dell’utente non cambia', () => {
  let l = C.applica(C.predefinita(), { tipo: 'togli', carta: 'mazzi' }).layout;
  l = C.applica(l, { tipo: 'nascondi', chiave: 'crediti' }).layout;
  l = C.applica(l, { tipo: 'nascondi', chiave: 'download:7' }).layout;
  const dati = { crediti: true, downloads: [{ id: '7', filename: 'tetto.pdf', state: 'completed', endedAt: new Date().toISOString() }] };
  assert.deepEqual(C.sinistra(dati, l).map((v) => v.chiave), []);
  assert.deepEqual(C.nascosteSinistra(dati, l).map((v) => v.chiave), ['crediti', 'download:7']);
  const r = C.applica(l, { tipo: 'mostra', chiave: 'crediti' });
  assert.equal(r.cambiato, true);
  assert.deepEqual(r.layout.nascoste, ['download:7']);
  assert.deepEqual(r.layout.destra, l.destra);
  assert.deepEqual(r.layout.tolte, ['mazzi']);
  assert.deepEqual(C.sinistra(dati, r.layout).map((v) => v.chiave), ['crediti']);
  assert.equal(C.applica(r.layout, { tipo: 'mostra' }).errore, 'chiave della carta mancante');
});

test('i promemoria di sinistra hanno un tetto e cade il più vecchio', () => {
  const tante = Array.from({ length: C.TETTO_NASCOSTE + 20 }, (_, i) => `download:${i}`);
  const l = C.normalizza({ nascoste: tante });
  assert.equal(l.nascoste.length, C.TETTO_NASCOSTE);
  assert.equal(l.nascoste[l.nascoste.length - 1], `download:${C.TETTO_NASCOSTE + 19}`);
  assert.ok(!l.nascoste.includes('download:0'));
});

test('lo strumento della chat nomina ogni carta di destra e accetta anche quelle di sinistra', () => {
  const def = globalThis.SN_ACTION_TOOLS.definitions().find((d) => d.function.name === 'CARTA_HOME');
  assert.ok(def, 'manca lo strumento CARTA_HOME');
  const p = def.function.parameters.properties;
  for (const id of C.IDS) assert.match(p.carta.description, new RegExp(`\\b${id} =`), `la chat non conosce la carta ${id}`);
  // Un elenco chiuso rifiuterebbe «l'avviso del backup» prima ancora di arrivare al main.
  assert.equal(p.carta.enum, undefined);
  assert.equal(p.prima_di.enum, undefined);
  assert.match(def.function.description, /sinistra/);
});

test('la colonna di sinistra ha lo stesso ordine per la home e per la chat', () => {
  const ora = Date.parse('2026-10-03T12:00:00Z');
  const iso = (ms) => new Date(ora + ms).toISOString();
  const dati = {
    timers: [
      { id: 't2', label: 'Forno', endsAt: iso(600e3) },
      { id: 't1', label: 'Pasta', endsAt: iso(60e3) },
      { id: 's1', kind: 'alarm', label: 'palestra', endsAt: iso(-1e3), ringing: true },
    ],
    notifiche: [{ id: 'n1', text: 'Il backup delle foto è finito.' }],
    downloads: [
      { id: 'd1', state: 'completed', filename: 'preventivo.pdf', endedAt: iso(-60e3) },
      { id: 'd2', state: 'progressing', filename: 'video.mp4' },
      { id: 'd3', state: 'completed', filename: 'vecchio.zip', endedAt: iso(-2 * 864e5) },
    ],
    lavori: [{ id: 'risposta-1', tipo: 'risposta', chat: 'c1', testo: 'confronta i preventivi', iniziato: ora - 5000 }],
    crediti: true,
  };
  const chiavi = (l) => C.sinistra(dati, l, ora).map((v) => v.chiave);
  assert.deepEqual(chiavi(null), [
    'crediti', 'timer:s1', 'lavoro:risposta-1', 'download:d2', 'timer:t1', 'timer:t2', 'avviso:n1', 'download:d1',
  ]);
  // L'ordine scelto dall'utente vale sotto quello che suona; una carta nascosta non c'è.
  const l = C.applica(C.applica(null, { tipo: 'ordina-sinistra', ordine: ['avviso:n1', 'timer:t2'] }).layout, { tipo: 'nascondi', chiave: 'download:d1' }).layout;
  assert.deepEqual(chiavi(l).slice(0, 4), ['crediti', 'timer:s1', 'lavoro:risposta-1', 'download:d2']);
  assert.ok(chiavi(l).indexOf('avviso:n1') < chiavi(l).indexOf('timer:t2'));
  assert.ok(!chiavi(l).includes('download:d1'));
});

test('una carta di sinistra si trova dalle parole dell’utente, senza confondersi con quelle di destra', () => {
  const sx = C.sinistra({
    timers: [{ id: 't1', label: 'Pasta', endsAt: new Date(Date.now() + 6e4).toISOString() }],
    notifiche: [{ id: 'n1', text: 'Il backup delle foto è finito.' }, { id: 'n2', text: 'Aggiornamento pronto' }],
    downloads: [{ id: 'd1', state: 'completed', filename: 'preventivo.pdf', endedAt: new Date().toISOString() }],
  }, null);
  const trova = (q) => C.trovaSinistra(q, sx);
  assert.deepEqual(trova('avviso:n2').voci.map((v) => v.chiave), ['avviso:n2']);
  assert.deepEqual(trova('l’avviso del backup').voci.map((v) => v.chiave), ['avviso:n1']);
  assert.deepEqual(trova("l'avviso del backup").voci.map((v) => v.chiave), ['avviso:n1']);
  assert.deepEqual(trova('gli avvisi').voci.map((v) => v.chiave), ['avviso:n1', 'avviso:n2']);
  assert.equal(trova('gli avvisi').perTipo, true);
  assert.deepEqual(trova('lo scaricamento del file').voci.map((v) => v.chiave), ['download:d1']);
  assert.deepEqual(trova('preventivo').voci.map((v) => v.chiave), ['download:d1']);
  assert.deepEqual(trova('il timer della pasta').voci.map((v) => v.chiave), ['timer:t1']);
  assert.deepEqual(trova('mazzi').voci, []);
  // «lo scaricamento del file»: fra i nomi dell'Editor c'è «file», ma esatto non lo è.
  assert.equal(C.risolvi('lo scaricamento del file', { esatto: true }), null);
  assert.equal(C.risolvi('la carta dei mazzi', { esatto: true }), 'mazzi');
});

test('la richiesta in corso non è una carta fra cui scegliere: «il backup» trova solo l’avviso', () => {
  const ora = Date.now();
  const lavori = [
    { id: 'mio', tipo: 'risposta', chat: 'c1', testo: 'togli il backup dalla home', iniziato: ora - 20e3 },
    { id: 'altro', tipo: 'risposta', chat: 'c2', testo: 'confronta i preventivi', iniziato: ora - 20e3 },
    { id: 'appena', tipo: 'comando', chat: 'c3', testo: 'npm install', iniziato: ora - 500 },
  ];
  const sx = C.sinistra({ notifiche: [{ id: 'n1', text: 'Il backup delle foto è finito.' }], lavori, chat: 'c1' }, null, ora);
  assert.deepEqual(sx.map((v) => v.chiave), ['lavoro:altro', 'avviso:n1']);
  assert.deepEqual(C.trovaSinistra('backup', sx).voci.map((v) => v.chiave), ['avviso:n1']);
  // Chi guarda da un'altra conversazione vede anche quel lavoro, quando dura.
  assert.deepEqual(C.lavoriAltrove(lavori, 'c9', ora).map((l) => l.id), ['mio', 'altro']);
});

test('l’azione è di livello 1 e la descrizione usa il nome che l’utente vede', () => {
  const L = globalThis.SN_ACTION_LEVELS;
  assert.equal(L.levelFor({ type: 'CARTA_HOME', operazione: 'togli', carta: 'mazzi' }), 1);
  assert.equal(L.describe({ type: 'CARTA_HOME', operazione: 'togli', carta: 'mazzi' }), 'Togliere la carta «Mazzi» dalla home');
  assert.match(L.describeDone({ type: 'CARTA_HOME', operazione: 'togli', carta: 'mazzi' }), /«Mazzi» tolta.*«altro»/);
  assert.match(L.describeDone({ type: 'CARTA_HOME', operazione: 'rimetti', carta: 'suggerimenti' }), /«Filo ti suggerisce» rimessa/);
  // Con la chiave di una carta di sinistra la frase resta senza nome, non «Carta una carta».
  assert.equal(L.describeDone({ type: 'CARTA_HOME', operazione: 'togli', carta: 'avviso:n1' }), 'Carta tolta dalla home');
  assert.equal(L.describe({ type: 'CARTA_HOME', operazione: 'sposta', carta: 'il timer della pasta' }), 'Spostare la carta «il timer della pasta» nella home');
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
  for (const tipo of ['CARTE_HOME_GET', 'CARTE_HOME_MODIFICA', 'EDITOR_RECENTI', 'LAVORI_IN_CORSO']) {
    assert.match(src, new RegExp(`on\\(MSG\\.${tipo}, soloFilo\\(`), `${tipo} risponde anche a un sito`);
  }
});
