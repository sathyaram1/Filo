// #589.1 — da una pagina che non è di Filo il main risponde solo alle domande e sui canali
// che il codice di Filo dentro le pagine usa davvero (liste in impostazioniPerOrigine.js).
// Senza il fix è ROSSO: la memoria, le pagine salvate e lo stato rispondevano a qualunque sito.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'messages.js'));
const { MSG } = globalThis.SN_MSG;
const W = require(join(ROOT, 'src', 'main', 'services', 'impostazioniPerOrigine.js'));
const O = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'origine.js'));

const leggi = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/^\s*\/\/.*$/gm, '');

// Gli script che page-preload.js carica nelle pagine web, più il preload stesso e lo zoom.
function scriptDeiSiti() {
  const preload = readFileSync(join(ROOT, 'src', 'preload', 'page-preload.js'), 'utf8');
  const file = ['src/preload/page-preload.js', 'src/preload/wheel-zoom.js'];
  for (const m of preload.matchAll(/require\(path\.join\((CONTENT_DIR|SHARED_DIR), '([\w.-]+\.js)'\)\)/g)) {
    file.push(`src/${m[1] === 'CONTENT_DIR' ? 'content' : 'shared'}/${m[2]}`);
  }
  assert.ok(file.some((f) => f.endsWith('content/content.js')) && file.length > 20, 'elenco degli script dei siti non trovato');
  return [...new Set(file)].filter((f) => !f.endsWith('/messages.js')).map((f) => ({ f, src: leggi(f) }));
}

function fileJs(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) fileJs(rel, out); else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

// I tipi che hanno un handler nel main (`on(MSG.X, …)` o `on('x', …)`).
function tipiRegistrati() {
  const tipi = new Set();
  for (const f of fileJs('src/main')) {
    for (const m of leggi(f).matchAll(/(?<![.\w$])on\(\s*(?:MSG\.([A-Z_0-9]+)|'([\w:-]+)')\s*,/g)) tipi.add(m[1] ? MSG[m[1]] : m[2]);
  }
  return tipi;
}

// I tipi che uno script mette in un messaggio: `type: MSG.X`, `type: 'x'`, o una costante
// locale che vale MSG.X o 'x' (i `T_GET` dei moduli cookie e simili).
function tipiNominati(src) {
  const alias = new Map();
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$.?]*MSG\??\.([A-Z_0-9]+))?\s*(?:\|\|\s*)?(?:'([\w:-]+)')?\s*[;,\n]/g)) {
    const v = m[2] ? MSG[m[2]] : m[3];
    if (v) alias.set(m[1], v);
  }
  const tipi = new Set();
  for (const m of src.matchAll(/\btype:\s*(?:[\w$.?]*MSG\??\.([A-Z_0-9]+)|'([\w:-]+)'|([A-Za-z_$][\w$]*))/g)) {
    const t = m[1] ? MSG[m[1]] : (m[2] || alias.get(m[3]));
    if (t) tipi.add(t);
  }
  return tipi;
}

// Nominati da un modulo caricato nelle pagine, ma mai chiesti da lì.
const NOMINATI_MA_NON_CHIESTI = new Map([
  ['feedback_fetch', 'shared/feedback.js lo chiede solo dal ponte window.filo delle pagine di Filo'],
]);

test('da un sito passano le domande dei content script, le altre no', () => {
  for (const t of ['get_settings', 'save_page', 'close_tab', 'ai_request', '_storage:get', 'get_clipboard_history']) {
    assert.equal(W.domandaAmmessaDaUnSito(t), true, t);
  }
  const personali = [
    MSG.FILO_GET_MEMORY, MSG.GET_SAVED_PAGES, MSG.FILO_GET_STATE, MSG.GET_ARCHIVED_TABS, MSG.GET_CATEGORIES,
    MSG.GET_CREDITS, MSG.AUTH_SIGNOUT, '_tabs:remove', '_tabs:create', '_storage:clear',
  ];
  for (const t of personali) {
    assert.ok(t, 'un tipo della prova non esiste più');
    assert.equal(W.domandaAmmessaDaUnSito(t, { inVista: true }), false, t);
  }
  for (const t of ['', undefined, null, 42, {}, 'GET_SETTINGS', ' get_settings', '__proto__', 'constructor']) {
    assert.equal(W.domandaAmmessaDaUnSito(t, { inVista: true }), false, String(t));
  }
});

test('le fotografie da un sito le chiede solo la scheda in primo piano', () => {
  for (const t of W.DOMANDE_WEB_IN_VISTA) {
    assert.ok(W.DOMANDE_WEB.has(t), `${t} deve essere prima di tutto una domanda ammessa`);
    assert.equal(W.domandaAmmessaDaUnSito(t, { inVista: true }), true, t);
    assert.equal(W.domandaAmmessaDaUnSito(t, { inVista: false }), false, t);
    assert.equal(W.domandaAmmessaDaUnSito(t), false, t);
  }
  assert.ok(W.DOMANDE_WEB_IN_VISTA.has(MSG.CAPTURE_VISIBLE_TAB) && W.DOMANDE_WEB_IN_VISTA.has(MSG.CAPTURE_FEEDBACK_TOPBAR));
});

test('chi è un sito: la scheda e la pagina che parla devono essere entrambe di Filo', () => {
  assert.equal(O.daUnSito('', {}), false, 'una chiamata interna al main non ha mittente');
  assert.equal(O.daUnSito('', undefined), false);
  assert.equal(O.daUnSito('filo://home/home.html', { url: 'filo://home/home.html' }), false);
  assert.equal(O.daUnSito('filo://shell/shell.html', { isShell: true }), false);
  for (const [origine, mittente] of [
    ['https://sito.example/', {}],
    ['http://127.0.0.1:8080/1', { url: 'http://127.0.0.1:8080/1', wc: {} }],
    ['about:blank', { url: 'about:blank' }],
    ['blob:https://sito.example/1', {}],
    ['filo://home/home.html', { url: 'https://sito.example/' }],
    ['', { wc: {} }],
    [' filo://home/', {}],
  ]) assert.equal(O.daUnSito(origine, mittente), true, `${origine} / ${JSON.stringify(mittente)}`);
});

test('in primo piano vale solo il frame principale della scheda attiva', () => {
  const principale = { frameTreeNodeId: 1 };
  const wc = { isDestroyed: () => false, mainFrame: principale };
  const win = { _filoTabs: { activeId: 7 } };
  assert.equal(O.inPrimoPiano({ win, wc, tab: { id: 7 }, frame: principale }), true);
  assert.equal(O.inPrimoPiano({ win, wc, tab: { id: 7 }, frame: { frameTreeNodeId: 1 } }), true);
  assert.equal(O.inPrimoPiano({ win, wc, tab: { id: 8 }, frame: principale }), false, 'scheda di sfondo');
  assert.equal(O.inPrimoPiano({ win, wc, tab: { id: 7 }, frame: { frameTreeNodeId: 2 } }), false, 'riquadro');
  assert.equal(O.inPrimoPiano({ win, wc, tab: { id: 7 }, frame: null }), false, 'frame sconosciuto');
  assert.equal(O.inPrimoPiano({ win: {}, wc, tab: { id: 7 }, frame: principale }), false, 'finestra senza schede (popup)');
  assert.equal(O.inPrimoPiano({ url: 'https://sito.example/' }), false);
  assert.equal(O.inPrimoPiano(undefined), false);
});

// Una domanda che un content script fa ma che manca dalla lista si spegnerebbe
// in silenzio solo sui siti; una ammessa che nessuno fa è una porta aperta per niente.
test('sentinella: le domande ammesse sono esattamente quelle del codice di Filo dentro le pagine', () => {
  const registrati = tipiRegistrati();
  assert.ok(registrati.has(MSG.GET_SETTINGS) && registrati.has('_storage:get') && registrati.size > 200, 'la sentinella non vede più gli handler del main');
  const chieste = new Map();
  for (const { f, src } of scriptDeiSiti()) {
    for (const t of tipiNominati(src)) {
      if (!registrati.has(t) || NOMINATI_MA_NON_CHIESTI.has(t)) continue;
      if (!chieste.has(t)) chieste.set(t, f);
    }
  }
  for (const t of ['cookies_config', 'close_other_menus', 'tab_activity', 'capture_visible_tab', '_storage:set']) {
    assert.ok(chieste.has(t), `la sentinella non vede più ${t}: la ricerca dei tipi si è rotta`);
  }
  const mancanti = [...chieste].filter(([t]) => !W.DOMANDE_WEB.has(t)).map(([t, f]) => `${t} (${f})`);
  assert.deepEqual(mancanti, [], 'domande fatte dal codice dentro le pagine ma non ammesse in impostazioniPerOrigine.js');
  const inutili = [...W.DOMANDE_WEB].filter((t) => !chieste.has(t));
  assert.deepEqual(inutili, [], 'domande ammesse dai siti che nessuno script delle pagine fa: vanno tolte');
  for (const t of W.DOMANDE_WEB) assert.ok(registrati.has(t), `domanda ammessa senza handler: ${t}`);
});

// Canali che vivono sulla singola scheda e controllano da sé chi parla (tabs.js).
const CANALI_DELLA_SCHEDA = ['filo:zoom-applicato', 'filo:zoom-proprio'];

test('sentinella: i canali ammessi sono quelli che il preload delle pagine web usa', () => {
  const usati = new Set();
  for (const f of ['src/preload/page-preload.js', 'src/preload/wheel-zoom.js']) {
    for (const m of leggi(f).matchAll(/\b(?:ipcRenderer|ipc)\.(?:invoke|send|sendSync)\(\s*'([\w:-]+)'/g)) usati.add(m[1]);
  }
  assert.ok(usati.has('filo:message') && usati.has('filo:fp-config'), 'la sentinella non vede più i canali del preload');
  const fuori = [...usati].filter((c) => !W.CANALI_WEB.has(c) && !CANALI_DELLA_SCHEDA.includes(c));
  assert.deepEqual(fuori, [], 'canali usati dal preload delle pagine web ma non ammessi');
  assert.deepEqual([...W.CANALI_WEB].filter((c) => !usati.has(c)), [], 'canali ammessi che il preload non usa');
});

// Ogni canale del main passa dalla regola del confine: in ipc.js tramite handle/ascolta,
// altrove solo i canali della singola scheda, che controllano chi parla.
test('sentinella: nessun canale si registra fuori dalla regola del confine', () => {
  const fuori = [];
  for (const f of fileJs('src/main')) {
    leggi(f).split('\n').forEach((r, i) => {
      if (!/\bipcMain\.(?:handle|handleOnce|on|once|addListener)\(|\.ipc\.(?:handle|handleOnce|on|once)\(/.test(r)) return;
      if (f === 'src/main/ipc.js' && /^const (?:handle|ascolta) = \(canale, fn\) => ipcMain\.(?:handle|on)\(canale,/.test(r)) return;
      if (f === 'src/main/tabs.js' && CANALI_DELLA_SCHEDA.some((c) => r.includes(`'${c}'`))) return;
      fuori.push(`${f}:${i + 1}: ${r.trim()}`);
    });
  }
  assert.deepEqual(fuori, [], 'canali registrati senza passare da handle/ascolta di ipc.js');
  const ipc = leggi('src/main/ipc.js');
  assert.ok((ipc.match(/^\s+handle\('/gm) || []).length > 20, 'la sentinella non vede più i canali di ipc.js');
});
