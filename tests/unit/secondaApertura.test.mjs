// #1606, #1606.1, #1092 — Riaprire Filo rimasto acceso senza la finestra principale (seconda copia, o Dock su Mac) la
// rifà e la porta davanti; la seconda copia esce prima di caricare i moduli; le schede si riaprono a init finiti.
// Regole: mostraFinestraNormale, riaperturaDaSistema e attendiAvvio in src/main/window.js; l'avvio in src/main/main.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = readFileSync(join(ROOT, 'src', 'main', 'main.js'), 'utf8');

// Come Electron: una finestra distrutta lancia a ogni metodo che non sia isDestroyed.
function finestraFinta({ distrutta = false, schede = true, incognito = false, minimizzata = false } = {}) {
  const chiamate = [];
  const una = {};
  const w = {
    chiamate, una, isDestroyed: () => distrutta, on() {}, once() {}, loadURL() {},
    webContents: { on() {}, once(ev, cb) { (una[ev] = una[ev] || []).push(cb); } },
  };
  const metodo = (nome, effetto = () => {}) => (...a) => {
    if (distrutta) throw new TypeError('Object has been destroyed');
    chiamate.push(nome);
    return effetto(...a);
  };
  w.isMinimized = metodo('isMinimized', () => minimizzata);
  w.restore = metodo('restore', () => { minimizzata = false; });
  for (const n of ['show', 'showInactive', 'moveTop', 'focus', 'setOpacity', 'setPosition']) w[n] = metodo(n);
  if (schede) w._filoTabs = { finta: true };
  if (incognito) w._filoIncognito = true;
  return w;
}

let finestre = [];
const nate = [];
const allUscita = [];
function BrowserWindow() {
  const w = finestraFinta();
  nate.push(w);
  finestre.push(w);
  return w;
}
BrowserWindow.getAllWindows = () => finestre.slice();
const electron = {
  BrowserWindow,
  session: {},
  screen: { getPrimaryDisplay: () => ({ scaleFactor: 1 }) },
  app: { on: (ev, cb) => { if (ev === 'before-quit') allUscita.push(cb); } },
};

// Le schede finte contano le riaperture: è quello che deve aspettare gli init dell'avvio.
class SchedeFinte {
  constructor(win) { this.win = win; this.tabs = []; this.riaperture = 0; }
  async restoreSession() { this.riaperture += 1; return true; }
  openTab() {}
}

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electron;
  const daFinestra = parent && /[\\/]src[\\/]main[\\/]window\.js$/.test(parent.filename || '');
  if (daFinestra && request === './tabs') return { TabManager: SchedeFinte };
  if (daFinestra && request === './shortcuts') return { collegaScorciatoie() {} };
  if (daFinestra && request === './protocol') return { registerFiloProtocolForSession() {} };
  return origLoad.call(this, request, parent, isMain);
};
const W = require(join(ROOT, 'src', 'main', 'window.js'));
Module._load = origLoad;

const avvisate = [];
W.onFinestraNormale((w) => avvisate.push(w));
const rivelata = (w) => w.chiamate.includes('focus') || w.chiamate.includes('showInactive');
const daCapo = (...lista) => { finestre = lista; nate.length = 0; avvisate.length = 0; };
const giro = () => new Promise((r) => setImmediate(r));

test('principale distrutta e finestrella di accesso aperta: ne nasce una nuova, davanti, e il main la riceve', () => {
  const principale = finestraFinta({ distrutta: true });
  const accesso = finestraFinta({ schede: false });
  daCapo(principale, accesso);
  const win = W.mostraFinestraNormale();
  assert.equal(nate.length, 1, 'chi riapre Filo deve ritrovare la finestra con le sue schede');
  assert.equal(win, nate[0]);
  assert.ok(rivelata(win), 'la finestra rifatta resta dietro: chi ha riaperto Filo non la vede');
  assert.deepEqual(avvisate, [win], 'senza l\'avviso il main resta puntato alla finestra distrutta');
  assert.deepEqual(accesso.chiamate, [], 'la finestrella di accesso non va toccata');
});

test('principale viva e ridotta a icona: si rimette su la stessa, senza farne un\'altra', () => {
  const principale = finestraFinta({ minimizzata: true });
  daCapo(principale);
  assert.equal(W.mostraFinestraNormale(), principale);
  assert.equal(nate.length, 0);
  assert.ok(principale.chiamate.includes('restore'), 'ridotta a icona resta sulla barra delle applicazioni');
  assert.ok(rivelata(principale));
});

test('aperta solo una finestra incognito: chi riapre Filo trova una finestra normale', () => {
  const incognito = finestraFinta({ incognito: true });
  daCapo(incognito);
  const win = W.mostraFinestraNormale();
  assert.equal(nate.length, 1);
  assert.equal(win, nate[0]);
  assert.ok(!incognito.chiamate.includes('focus'), 'davanti va la finestra normale, non l\'incognito');
});

test('Mac, clic sul Dock con la finestrella di accesso a schermo e la principale chiusa: torna la finestra con le schede', () => {
  const accesso = finestraFinta({ schede: false });
  daCapo(finestraFinta({ distrutta: true }), accesso);
  const win = W.riaperturaDaSistema(true);
  assert.equal(nate.length, 1, 'su Mac il clic sull\'icona non ridà la finestra di Filo');
  assert.equal(win, nate[0]);
  assert.ok(rivelata(win));
  assert.deepEqual(avvisate, [win]);
  assert.deepEqual(accesso.chiamate, [], 'la finestrella di accesso resta com\'è');
});

test('Mac, clic sul Dock con la principale viva: a schermo ci pensa il sistema, ridotta a icona torna su', () => {
  const aperta = finestraFinta();
  daCapo(aperta);
  assert.equal(W.riaperturaDaSistema(true), null);
  assert.deepEqual(aperta.chiamate, [], 'con la finestra a schermo il Dock non deve spostare niente');

  const ridotta = finestraFinta({ minimizzata: true });
  daCapo(ridotta);
  assert.equal(W.riaperturaDaSistema(false), ridotta);
  assert.equal(nate.length, 0);
  assert.ok(ridotta.chiamate.includes('restore'));
  assert.ok(rivelata(ridotta));
});

test('le schede si riaprono solo a init dell\'avvio finiti, e la finestra intanto c\'è già', async () => {
  let libera;
  W.attendiAvvio(new Promise((r) => { libera = r; }));
  try {
    daCapo();
    const win = W.assicuraFinestraNormale();
    assert.equal(nate.length, 1, 'la finestra deve nascere senza aspettare gli init');
    for (const cb of win.una['did-finish-load'] || []) cb();
    await giro();
    assert.equal(win._filoTabs.riaperture, 0, 'la prima scheda partirebbe prima di ad-blocker, impronta e permessi');
    libera();
    await giro();
    await giro();
    assert.equal(win._filoTabs.riaperture, 1, 'finiti gli init le schede non si sono riaperte');
    assert.ok(rivelata(win));
  } finally {
    W.attendiAvvio(Promise.resolve());
  }
});

test('un init dell\'avvio che fallisce non lascia la finestra senza schede', async () => {
  W.attendiAvvio(Promise.reject(new Error('disco')));
  daCapo();
  const win = W.assicuraFinestraNormale();
  for (const cb of win.una['did-finish-load'] || []) cb();
  await giro();
  await giro();
  assert.equal(win._filoTabs.riaperture, 1);
  W.attendiAvvio(Promise.resolve());
});

const corpo = (re, cosa) => { const m = MAIN.match(re); assert.ok(m, `non trovo ${cosa} in main.js`); return m[1]; };

test('la seconda apertura e l\'invito da fuori chiedono la finestra, mai il riferimento del main', () => {
  const seconda = corpo(/app\.on\(\s*'second-instance'[^{]*\{([\s\S]*?)\n\}\);/, 'il gestore di second-instance');
  assert.match(seconda, /ridaiFinestraNormale\(\)/, 'la seconda apertura deve passare da ridaiFinestraNormale');
  // «Prima dell'avvio non si crea niente» vive in window.js, per lei, l'invito e le voci della barra (#2031).
  assert.doesNotMatch(seconda, /mainWindow/, 'la regola dell\'avvio scritta una seconda volta qui');
  const invito = corpo(/function apriInvito\(code\) \{([\s\S]*?)\n\}/, 'apriInvito');
  assert.match(invito, /ridaiFinestraNormale\(\)/, 'l\'invito arrivato da fuori deve aprire Crediti in una finestra viva');
  assert.doesNotMatch(invito, /mainWindow/, 'la regola dell\'avvio scritta una seconda volta qui');
  assert.doesNotMatch(invito, /\(\s*mainWindow\s*\)|,\s*mainWindow\s*\)/, 'passare il riferimento del main porta Crediti in una finestra distrutta');
});

test('su Mac la riapertura (activate) passa dalla stessa regola, non da «nessuna finestra»', () => {
  const activate = corpo(/app\.on\(\s*'activate'([\s\S]*?)\);\n/, 'il gestore di activate');
  assert.match(activate, /riaperturaDaSistema\(/);
  assert.doesNotMatch(activate, /getAllWindows\(\)\.length/, 'con la finestrella di accesso aperta le finestre non sono zero');
});

test('il lucchetto d\'istanza singola sta in cima: dopo userData, prima di shim, loader e di ogni altro modulo', () => {
  const lucchetto = MAIN.indexOf('requestSingleInstanceLock()');
  const userData = MAIN.indexOf("app.setPath('userData'");
  assert.ok(userData >= 0 && lucchetto > userData, 'il lucchetto vale per la cartella dei dati: va chiesto dopo averla fissata');
  for (const modulo of ["require('./shim/chrome-api')", "require('./services/loader')", "require('./window')"]) {
    const dove = MAIN.indexOf(modulo);
    assert.ok(dove > lucchetto, `${modulo} si carica anche nella seconda copia, che deve solo uscire`);
  }
  assert.deepEqual([...MAIN.slice(0, lucchetto).matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]), ['electron', 'node:path']);
  assert.match(MAIN, /if \(!app\.requestSingleInstanceLock\(\)\) \{\s*app\.quit\(\);\s*return;\s*\}/,
    'senza lucchetto la seconda copia deve uscire lì, senza proseguire nel file');
});

test('gli init che la prima scheda aspetta partono insieme, e la finestra non li aspetta', () => {
  const pronti = corpo(/const pronti = Promise\.all\(\[([\s\S]*?)\n {2}\]\);/, 'gli init dell\'avvio in Promise.all');
  for (const init of ["'./services/fingerprint').init(", "'./services/adblock').init(", "'./services/permessiPagine').carica(",
    "'./tabs/tabCookies').loadRemembered(", "'./services/downloads').init("]) {
    assert.ok(pronti.includes(init), `${init} non parte insieme agli altri`);
  }
  assert.doesNotMatch(MAIN, /await require\('\.\/services\/(adblock|permessiPagine|fingerprint|firmatariC2pa|editorFiles)'\)/,
    'un init atteso in fila ritarda la finestra');
  assert.ok(MAIN.indexOf('attendiAvvio(pronti)') < MAIN.indexOf('mainWindow = createMainWindow()'));
});

// Ultima: l'uscita in corso è uno stato del modulo che non torna indietro.
test('durante l\'uscita non nasce nessuna finestra, e niente lancia', () => {
  daCapo(finestraFinta({ distrutta: true }));
  for (const cb of allUscita) cb();
  assert.equal(W.mostraFinestraNormale(), null);
  assert.equal(W.riaperturaDaSistema(true), null);
  assert.equal(nate.length, 0, 'una finestra nuova annullerebbe l\'uscita');
});
