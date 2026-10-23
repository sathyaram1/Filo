// #1433 — il pannello di destra delle app: catalogo e mosse (src/shared/pannelliApp.js), regolazioni, tasto, e il bordo
// destro che il main guarda (src/main/bordoDestro.js) senza Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Il main legge il puntatore da `electron.screen`: qui lo dà la prova.
const puntatore = { x: 0, y: 0 };
const Module = require('node:module');
const caricaVero = Module._load;
Module._load = function (req, ...resto) {
  return req === 'electron' ? { screen: { getCursorScreenPoint: () => ({ ...puntatore }) } } : caricaVero.call(this, req, ...resto);
};
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'tasti.js'));
require(join(ROOT, 'src', 'shared', 'pannelliApp.js'));
const P = globalThis.SN_PANNELLI_APP;
const C = globalThis.SN_CONST;
const T = globalThis.SN_TASTI;

test('l\'Editor parte con Conteggio, Cerca e sostituisci e Commenta; grassetto, corsivo e sottolineato stanno nel catalogo', () => {
  const s = P.normalizza('editor', null);
  assert.deepEqual(s.elementi, ['word-count', 'search-replace', 'comment']);
  const ids = P.catalogo('editor').elementi.map((e) => e.id);
  for (const id of ['text-size', 'align', 'font', 'undo', 'redo', 'settings', 'bold', 'italic', 'underline']) assert.ok(ids.includes(id), id);
  assert.equal(P.catalogo('mazzi'), null, 'un\'app senza catalogo non ha pannello');
  assert.equal(P.normalizza('mazzi', {}), null);
});

test('le mosse: entrare, spostarsi, uscire; niente doppioni, niente ignoti', () => {
  let s = P.normalizza('editor', null);
  s = P.posa('editor', s, 'bold', 'search-replace');
  assert.deepEqual(s.elementi, ['word-count', 'bold', 'search-replace', 'comment']);
  s = P.posa('editor', s, 'word-count', null);
  assert.deepEqual(s.elementi, ['bold', 'search-replace', 'comment', 'word-count'], 'chi c\'è già si sposta, non si duplica');
  s = P.togli('editor', s, 'comment');
  assert.deepEqual(s.elementi, ['bold', 'search-replace', 'word-count']);
  assert.equal(P.togli('editor', s, 'comment'), null, 'togliere chi non c\'è non è una mossa');
  assert.equal(P.posa('editor', s, 'chat'), null, 'la chat non è più uno strumento');
  const sporco = P.normalizza('editor', { elementi: ['bold', 'bold', 'nonEsiste', 42, 'font'] });
  assert.deepEqual(sporco.elementi, ['bold', 'font']);
  assert.deepEqual(P.normalizza('editor', { elementi: [] }).elementi, [], 'svuotarlo è una scelta che resta');
});

test('la configurazione tiene solo quello che lo strumento sa usare, e svuotata si toglie', () => {
  let s = P.normalizza('editor', null);
  s = P.configura('editor', s, 'word-count', { count: 'chars', shortcut: 'Ctrl+Shift+1', tasto: 'cs|Digit1', colore: 'rosso' });
  assert.deepEqual(s.config['word-count'], { count: 'chars', shortcut: 'Ctrl+Shift+1', tasto: 'cs|Digit1' });
  s = P.configura('editor', s, 'font', { shortcut: 'Ctrl+Shift+2' });
  assert.equal(s.config.font, undefined, 'il font ha più azioni: niente scorciatoia');
  s = P.configura('editor', s, 'word-count', { count: 'nonso' });
  assert.equal(s.config['word-count'], undefined, 'una configurazione vuota non resta');
});

test('la migrazione porta dai vecchi moduli cosa conta il conteggio e le scorciatoie, una volta sola', () => {
  const collezione = {
    activeId: 'b',
    files: [
      { id: 'a', meta: { modified: '2026-10-20T10:00:00Z' }, modules: [
        { type: 'word-count', data: { count: 'sentences' } },
        { type: 'bold', data: { shortcut: 'Ctrl+Shift+3', tasto: 'cs|Digit3' } },
      ] },
      { id: 'b', meta: { modified: '2026-10-01T10:00:00Z' }, modules: [
        { type: 'word-count', data: { count: 'chars', shortcut: 'Ctrl+Shift+3', tasto: 'cs|Digit3' } },
        { type: 'chat', data: { messages: [{ role: 'user', content: 'ciao' }] } },
        { type: 'switch', data: { pages: [] } },
      ] },
    ],
  };
  const config = P.configDaModuli('editor', collezione);
  assert.deepEqual(config['word-count'], { count: 'chars', shortcut: 'Ctrl+Shift+3', tasto: 'cs|Digit3' }, 'vince il documento aperto');
  assert.equal(config.bold, undefined, 'la stessa scorciatoia resta al primo');
  assert.equal(config.chat, undefined);
  const migrato = P.migra('editor', null, collezione);
  assert.equal(migrato.migrato, true);
  assert.deepEqual(migrato.elementi, ['word-count', 'search-replace', 'comment'], 'le disposizioni della griglia si buttano');
  assert.equal(P.migra('editor', migrato, collezione), null, 'una volta sola');
  const scelta = P.configura('editor', P.normalizza('editor', null), 'word-count', { count: 'paragraphs' });
  assert.equal(P.migraConfig('editor', scelta, config).config['word-count'].count, 'paragraphs', 'quello che l\'utente ha già scelto vince');
});

test('uno strumento fuori dalla partenza con una scorciatoia sul vecchio modulo entra nel pannello, così il tasto funziona ancora', () => {
  const collezione = { activeId: 'a', files: [{ id: 'a', modules: [
    { type: 'undo', data: { shortcut: 'Ctrl+Shift+2' } },
    { type: 'bold', data: { shortcut: 'Ctrl+G' } },
    { type: 'italic', data: {} },
  ] }] };
  const migrato = P.migra('editor', null, collezione);
  assert.deepEqual(migrato.elementi, ['word-count', 'search-replace', 'comment', 'undo', 'bold'], 'in fondo, nell\'ordine del catalogo; senza scorciatoia resta fuori');
  assert.equal(migrato.config.bold.shortcut, 'Ctrl+G');
  const tolto = P.togli('editor', P.normalizza('editor', null), 'comment');
  assert.ok(!P.migra('editor', tolto, { activeId: 'a', files: [{ id: 'a', modules: [{ type: 'comment', data: {} }] }] }).elementi.includes('comment'), 'senza scorciatoia non rientra chi l\'utente aveva tolto');
});

test('chi parla con Filo nomina uno strumento a parole', () => {
  assert.equal(P.risolvi('editor', 'grassetto'), 'bold');
  assert.equal(P.risolvi('editor', 'il Conteggio'), 'word-count');
  assert.equal(P.risolvi('editor', 'cerca e sostituisci'), 'search-replace');
  assert.equal(P.risolvi('editor', 'search-replace'), 'search-replace');
  assert.equal(P.risolvi('editor', 'la torta'), null);
});

test('le regolazioni del pannello: limiti della barra, lucchetto spento di serie', () => {
  assert.deepEqual(C.DEFAULT_SETTINGS.pannelloDestro, { spinta: true, attesaMs: 250, uscitaMs: 400, striscia: true, bloccato: false });
  assert.deepEqual(C.opzioniPannelloDestro({ attesaMs: 1, uscitaMs: 99999, bloccato: true, striscia: false }),
    { spinta: true, attesaMs: 100, uscitaMs: 5000, striscia: false, bloccato: true });
  assert.deepEqual(C.opzioniPannelloDestro('rotto'), C.DEFAULT_SETTINGS.pannelloDestro);
  require(join(ROOT, 'src', 'shared', 'preferences.js'));
  const Pref = globalThis.SN_PREF;
  assert.deepEqual(Pref.buildPreferencePartial('pannello_bloccato', 'sì').partial, { pannelloDestro: { bloccato: true } });
  assert.deepEqual(Pref.buildPreferencePartial('pannello_attesa', '0,5 secondi').partial, { pannelloDestro: { attesaMs: 500 } });
});

test('Ctrl+\\ (Cmd+\\ su Mac) apre il pannello; con Shift o Alt è un altro tasto, e sui siti non è preso', () => {
  assert.equal(T.comandoPannello({ type: 'keyDown', control: true, key: '\\' }), true);
  assert.equal(T.comandoPannello({ type: 'keyDown', meta: true, key: '\\' }), true);
  assert.equal(T.comandoPannello({ ctrlKey: true, key: '\\' }), true);
  assert.equal(T.comandoPannello({ control: true, shift: true, key: '\\' }), false);
  assert.equal(T.comandoPannello({ control: true, alt: true, key: '\\' }), false);
  assert.equal(T.comandoPannello({ key: '\\' }), false);
  assert.equal(T.etichettaPannello('darwin'), 'Cmd+\\');
  assert.equal(T.etichettaPannello('win32'), 'Ctrl+\\');
  assert.equal(T.riservato('Ctrl+\\', 'win32'), false, 'sui siti il tasto resta loro');
  assert.ok(T.rifiutoScorciatoiaFilo('explain-selection', 'Ctrl+\\', 'win32'), 'un\'azione di Filo non se lo prende');
});

// Il bordo destro col puntatore finto: la geometria e la regola del puntatore fermo, senza Electron.
function bordoFinto({ larghezza = 1100, alto = 40, attesaMs = 250 } = {}) {
  const cb = { x: 100, y: 50, width: larghezza, height: 800 };
  const { BordoDestro } = require(join(ROOT, 'src', 'main', 'bordoDestro.js'));
  const mandati = [];
  const tab = { id: 't1', view: { webContents: { mainFrame: { send: (_c, m) => mandati.push(m) } } }, pannelloApp: { app: 'editor', aperto: false } };
  const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, getContentBounds: () => cb };
  const barra = { win, tabs: { tabs: [tab], activeId: 't1', vistaSottoIlVuoto: () => tab.view }, alto: () => alto, tasti: { scheda: false, shell: false }, trascinamento: null };
  const b = new BordoDestro(barra);
  b.impostazioni({ attesaMs });
  const sposta = (x, y) => { puntatore.x = cb.x + x; puntatore.y = cb.y + y; };
  const ferma = () => { for (const k of Object.keys(b.timer)) b._ferma(k); };
  return { b, tab, mandati, sposta, cb, ferma };
}
const aspetta = (ms) => new Promise((r) => setTimeout(r, ms));

test('il bordo destro: fermo apre, nella fila delle schede no, scorrendo lungo il bordo no', async (t) => {
  const { b, mandati, sposta, cb, ferma } = bordoFinto({ attesaMs: 150 });
  t.after(ferma);
  const aperture = () => mandati.filter((m) => m.azione === 'apri').length;
  // Nella fascia delle schede, in alto a destra (riduci, ingrandisci, chiudi): niente.
  sposta(cb.width - 2, 20);
  b._guarda();
  await aspetta(400);
  assert.equal(aperture(), 0, 'nella fila delle schede non si apre');
  b._ferma('sonda');
  // Lungo il bordo, scorrendo in verticale: niente.
  sposta(cb.width - 2, 200);
  b._guarda();
  for (let i = 0; i < 10; i++) { await aspetta(40); sposta(cb.width - 2, 200 + i * 15); }
  assert.equal(aperture(), 0, 'chi scorre lungo il bordo mira la barra di scorrimento');
  // Fermo sul bordo: la striscia si accende, poi si apre.
  await aspetta(60);
  assert.ok(mandati.some((m) => m.azione === 'bordo' && m.acceso === true), 'la striscia si accende mentre aspetta');
  await aspetta(300);
  assert.equal(aperture(), 1, 'fermo sul bordo si apre');
  assert.equal(mandati.find((m) => m.azione === 'apri').motivo, 'spinta');
  b._ferma('sonda');
  b._ferma('uscita');
});

test('sopra la pagina senza pannello, o oltre il bordo su un altro schermo, il bordo destro non apre', async (t) => {
  const { b, tab, mandati, sposta, cb, ferma } = bordoFinto({ attesaMs: 100 });
  t.after(ferma);
  sposta(cb.width + 30, 300);
  b._guarda();
  await aspetta(300);
  assert.equal(mandati.filter((m) => m.azione === 'apri').length, 0, 'il puntatore sull\'altro schermo è lontano');
  b._ferma('sonda');
  tab.pannelloApp = null;
  sposta(cb.width - 1, 300);
  b._guarda();
  await aspetta(300);
  assert.equal(mandati.filter((m) => m.azione === 'apri').length, 0, 'una pagina senza pannello non apre niente');
  assert.equal(b.tasto({ type: 'keyDown', control: true, key: '\\' }), false, 'e il tasto resta alla pagina');
});

test('la pagina disegna il pannello coi suoi pezzi, e l\'Editor non ha più griglia', () => {
  const html = readFileSync(join(ROOT, 'src', 'pages', 'editor', 'editor.html'), 'utf8');
  for (const pezzo of ['pannelliApp.js', 'pannelloDestro.js', 'pannelloDestro.css']) assert.ok(html.includes(pezzo), pezzo);
  for (const via of ['id="grid"', 'id="splitter"', 'id="sidebar"', 'id="settingsView"']) assert.ok(!html.includes(via), via);
});
