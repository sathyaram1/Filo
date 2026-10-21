// src/shared/riquadriInArrivo.js (#1560): un riquadro che carica il suo indirizzo, toccato da fuori prima del suo load,
// perde il preload e dentro Filo sparisce. Qui la regola su DOM finti che contano ogni tocco, e la sentinella: nei
// preload e nei content script nessuno tocca contentWindow/contentDocument di un riquadro senza passare dalla regola.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SORGENTE = readFileSync(join(ROOT, 'src', 'shared', 'riquadriInArrivo.js'), 'utf8');

// Un modulo nuovo per ogni prova: il conto dei load è di chi l'ha acceso.
function carica() {
  const ctx = vm.createContext({ URL });
  vm.runInContext(SORGENTE, ctx);
  return ctx.SN_RIQUADRI_IN_ARRIVO;
}

function finestraFinta(origine = 'https://sito.example') {
  const ascolti = [];
  const osservatori = [];
  const doc = {
    frames: [],
    location: { origin: origine },
    baseURI: `${origine}/pagina`,
    querySelectorAll() { return this.frames.filter((f) => f.ownerDocument === doc); },
    contains(el) { return this.frames.includes(el); },
  };
  const win = {
    document: doc,
    addEventListener(tipo, fn, cattura) { ascolti.push({ tipo, fn, cattura }); },
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() { osservatori.push(this.cb); } },
    caricato(f) { for (const a of ascolti) if (a.tipo === 'load' && a.cattura) a.fn({ target: f }); },
    rimesso(n) { for (const cb of osservatori) cb([{ addedNodes: [n] }]); },
  };
  doc.defaultView = win;
  return win;
}

// Un riquadro che conta chi gli tocca la finestra o il documento.
function riquadro(win, { src = null, srcdoc = null, ombra = false, figlio = null } = {}) {
  const attrs = {};
  if (src !== null) attrs.src = src;
  if (srcdoc !== null) attrs.srcdoc = srcdoc;
  const finestraFiglio = figlio || { nome: 'figlio' };
  const f = {
    nodeType: 1,
    localName: 'iframe',
    tocchi: 0,
    ownerDocument: win.document,
    firstElementChild: null,
    hasAttribute: (k) => Object.prototype.hasOwnProperty.call(attrs, k),
    getAttribute: (k) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = v; },
    getRootNode: () => (ombra ? { ombra: true } : win.document),
    get contentWindow() { f.tocchi++; return finestraFiglio; },
    get contentDocument() { f.tocchi++; return { documentElement: {} }; },
  };
  win.document.frames.push(f);
  return f;
}

test('un riquadro che carica il suo indirizzo non si tocca, né la finestra né il documento', () => {
  const R = carica();
  const win = finestraFinta();
  R.osserva(win);
  const f = riquadro(win, { src: '/commenti' });
  assert.equal(R.inArrivo(f), true);
  assert.equal(R.finestra(f), null);
  assert.equal(R.documento(f), null);
  assert.equal(f.tocchi, 0, 'toccato prima del suo load: perderebbe il preload');
});

test('dopo il suo load si tocca, e torna in arrivo se cambia indirizzo o rientra nella pagina', () => {
  const R = carica();
  const win = finestraFinta();
  R.osserva(win);
  const f = riquadro(win, { src: '/commenti' });
  win.caricato(f);
  assert.equal(R.inArrivo(f), false);
  assert.equal(R.finestra(f).nome, 'figlio');
  f.setAttribute('src', '/altro');
  assert.equal(R.inArrivo(f), true, 'col nuovo indirizzo ricarica da capo');
  win.caricato(f);
  assert.equal(R.inArrivo(f), false);
  win.rimesso(f);
  assert.equal(R.inArrivo(f), true, 'rimesso nella pagina, ricarica da capo');
  win.caricato(f);
  const contenitore = { nodeType: 1, firstElementChild: {}, getElementsByTagName: () => [f] };
  win.rimesso(contenitore);
  assert.equal(R.inArrivo(f), true, 'rimesso dentro un contenitore');
});

test('un riquadro vuoto o about:blank non ha un preload da perdere: si tocca subito', () => {
  const R = carica();
  const win = finestraFinta();
  R.osserva(win);
  for (const src of [null, '', 'about:blank', '  ABOUT:BLANK ']) {
    const f = riquadro(win, { src });
    assert.equal(R.inArrivo(f), false, `src ${JSON.stringify(src)}`);
    assert.ok(R.finestra(f));
  }
  assert.equal(R.inArrivo(riquadro(win, { srcdoc: '<p>ciao</p>' })), true, 'srcdoc: il suo documento arriva dopo');
});

test('in una radice ombra il load non si vede: si fa come prima, e lo dice', () => {
  const R = carica();
  const win = finestraFinta();
  R.osserva(win);
  const f = riquadro(win, { src: '/commenti', ombra: true });
  assert.equal(R.inArrivo(f), false);
});

test('senza il conto dei load (pagine interne) nessuno risulta in arrivo', () => {
  const R = carica();
  const win = finestraFinta();
  const f = riquadro(win, { src: '/commenti' });
  assert.equal(R.inArrivo(f), false);
  assert.equal(R.qualcunoInArrivo(), false);
  assert.ok(R.finestra(f));
});

test('chi tocca alla cieca aspetta finché qualcuno è in arrivo, anche nel riquadro di un riquadro', () => {
  const R = carica();
  const win = finestraFinta();
  R.osserva(win);
  const sotto = { qualcunoInArrivo: () => true };
  const f = riquadro(win, { src: '/a', figlio: { SN_RIQUADRI_IN_ARRIVO: sotto } });
  assert.equal(R.qualcunoInArrivo(), true);
  win.caricato(f);
  assert.equal(R.qualcunoInArrivo(), true, 'il riquadro dentro di lui sta ancora arrivando');
  sotto.qualcunoInArrivo = () => false;
  assert.equal(R.qualcunoInArrivo(), false);
});

test('chi ha scritto: dalla sua finestra se è della stessa origine, senza toccare nessun altro', () => {
  const R = carica();
  const win = finestraFinta();
  R.osserva(win);
  const arriva = riquadro(win, { src: '/in-arrivo' });
  const mittente = riquadro(win, { src: '/mittente' });
  win.caricato(mittente);
  const w = { frameElement: mittente };
  assert.equal(R.riquadroDi(w, win.document), mittente);
  assert.equal(arriva.tocchi + mittente.tocchi, 0);
});

test('chi ha scritto da un\'altra origine mentre arriva si trova lo stesso, e quelli della stessa origine restano intatti', () => {
  const R = carica();
  const win = finestraFinta();
  R.osserva(win);
  const nostro = riquadro(win, { src: '/commenti' });
  const caricato = riquadro(win, { src: 'https://altro.example/x' });
  win.caricato(caricato);
  const lettore = { get frameElement() { throw new Error('SecurityError'); } };
  const pubblicita = riquadro(win, { src: 'https://pub.example/lettore', figlio: lettore });
  assert.equal(R.riquadroDi(lettore, win.document), pubblicita);
  assert.equal(nostro.tocchi, 0, 'il riquadro della stessa origine in arrivo non si tocca');
  assert.equal(R.riquadroDi({ get frameElement() { throw new Error('x'); } }, win.document), null);
});

// ── Sentinella ──────────────────────────────────────────────────────────────
// Dove gira Filo dentro le pagine web (preload, content script, moduli condivisi) la finestra o il documento di un
// riquadro si prendono da SN_RIQUADRI_IN_ARRIVO, o su una riga che chiede prima `inArrivo`. Uno script nei frame figli
// (alla cieca) sta in un file che chiede `qualcunoInArrivo`. Il mondo della pagina (riquadri-vuoti.js) li nomina fra
// virgolette e non conta: un tocco da lì il preload non lo toglie.
function sorgenti(cartella) {
  const out = [];
  for (const voce of readdirSync(join(ROOT, cartella), { withFileTypes: true })) {
    const p = join(cartella, voce.name);
    if (voce.isDirectory()) out.push(...sorgenti(p));
    else if (voce.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('sentinella: nessuno tocca un riquadro senza passare dalla regola dei riquadri in arrivo', () => {
  const file = ['src/preload', 'src/content', 'src/shared'].flatMap(sorgenti)
    .filter((p) => !p.endsWith(join('shared', 'riquadriInArrivo.js')));
  const fuori = [];
  for (const p of file) {
    const testo = readFileSync(join(ROOT, p), 'utf8');
    testo.split('\n').forEach((riga, i) => {
      if (/^\s*\/\//.test(riga)) return;
      if (/\.content(Window|Document)\b/.test(riga) && !/inArrivo/.test(riga)) fuori.push(`${relative(ROOT, join(ROOT, p))}:${i + 1}: ${riga.trim()}`);
      const m = riga.match(/(\w+)\.executeJavaScriptInIsolatedWorld\(/);
      if (m && m[1] !== 'webFrame' && !/qualcunoInArrivo/.test(testo)) fuori.push(`${p}:${i + 1}: script alla cieca senza qualcunoInArrivo`);
    });
  }
  assert.deepEqual(fuori, [], 'passa da SN_RIQUADRI_IN_ARRIVO (finestra, documento, riquadroDi) o chiedi inArrivo sulla stessa riga');
});
