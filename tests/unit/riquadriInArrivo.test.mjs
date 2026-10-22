// src/shared/riquadriInArrivo.js (#1560): un riquadro che carica il suo indirizzo, toccato da fuori prima del suo load,
// perde il preload e dentro Filo sparisce. Qui la regola su DOM finti che contano ogni tocco, e la sentinella: nei
// preload e nei content script nessuno tocca contentWindow/contentDocument di un riquadro senza passare dalla regola.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
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
    URL: `${origine}/pagina`,
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

test('vuoto, about:, srcdoc o d\'altra origine non ha niente da perdere: si tocca subito', () => {
  const R = carica();
  const win = finestraFinta();
  R.osserva(win);
  for (const src of [null, '', 'about:blank', '  ABOUT:BLANK ', 'https://altro.example/x', 'data:text/html,ciao']) {
    const f = riquadro(win, { src });
    assert.equal(R.inArrivo(f), false, `src ${JSON.stringify(src)}`);
    assert.ok(R.finestra(f));
  }
  assert.equal(R.inArrivo(riquadro(win, { src: '/x', srcdoc: '<p>ciao</p>' })), false, 'srcdoc vince su src e non ha un preload');
  assert.equal(R.inArrivo(riquadro(win, { src: 'https://sito.example/assoluto' })), true, 'stessa origine scritta per intero');
});

test('il preload del riquadro, appena parte, dice a chi lo ospita che da adesso lo può toccare', () => {
  const R = carica();
  const win = finestraFinta();
  R.osserva(win);
  const f = riquadro(win, { src: '/commenti' });
  assert.equal(R.inArrivo(f), true);
  // Il figlio accende il suo conto: si presenta al padre con il suo elemento.
  const RFiglio = carica();
  const docFiglio = { URL: 'https://sito.example/commenti', baseURI: 'https://sito.example/commenti', querySelectorAll: () => [] };
  RFiglio.osserva({
    document: docFiglio, frameElement: f, parent: { SN_RIQUADRI_IN_ARRIVO: R },
    addEventListener() {}, MutationObserver: class { observe() {} },
  });
  assert.equal(R.inArrivo(f), false, 'arrivato prima del suo load: la parola di tradurre lo raggiunge');
  assert.equal(f.tocchi, 0);
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

test('chi ha scritto da un\'altra origine si trova, e quelli della stessa origine in arrivo restano intatti', () => {
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

// #1429: la stessa regola nel corpo che Filo mette nella pagina e nel main.
test('nella pagina: un ospite inserito di nuovo, anche solo spostato, torna in volo; moveBefore no', () => {
  const s = readFileSync(join(ROOT, 'src/preload/riquadri-vuoti.js'), 'utf8');
  assert.match(s, /nodi: function[\s\S]*?ripartono\(a\[i\]\)/, 'senza, un riquadro spostato si tocca prima del suo load');
  assert.match(s, /gamma: function[\s\S]*?ripartono\(a\[0\]\)/);
  assert.match(s, /m === 'moveBefore' \? SE\.sposta : SE\.nodi/, 'moveBefore tiene il documento: in volo non arriverebbe più');
  assert.doesNotMatch(s.match(/sposta: function[^\n]*/)[0], /ripartono/);
});

test('lato main: un riquadro senza ancora un documento suo ha url vuoto, e non si esegue', () => {
  const { riquadroArrivato } = require('../../src/main/services/riquadroArrivato.js');
  const top = { url: 'https://esempio.test/', detached: false };
  top.top = top;
  const figlio = (url, extra = {}) => ({ url, top, detached: false, ...extra });
  assert.equal(riquadroArrivato(top), true);
  assert.equal(riquadroArrivato(figlio('')), false, 'prima del primo commit');
  assert.equal(riquadroArrivato(figlio('about:blank')), true, 'il vuoto scritto dalla pagina si legge');
  assert.equal(riquadroArrivato(figlio('https://esempio.test/dentro')), true);
  assert.equal(riquadroArrivato(figlio('https://esempio.test/dentro', { detached: true })), false);
  assert.equal(riquadroArrivato(null), false);
  assert.equal(riquadroArrivato({ get url() { throw new Error('distrutto'); }, top }), false);
});

test('lato main: chi esegue codice in un riquadro chiede prima se è arrivato', () => {
  // Il riquadro che il blocco ha fermato non arriverà mai: il segnale gli va dato prima, e il preload lì non serve.
  const ECCEZIONI = new Set(['src/main/services/adblock.js']);
  const file = [];
  const giro = (dir) => {
    for (const d of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${d.name}`;
      if (d.isDirectory()) giro(p);
      else if (d.name.endsWith('.js')) file.push(p);
    }
  };
  giro('src/main');
  // Un riquadro si riconosce da chi non è una pagina, qualunque nome abbia (`genitore`, `figlio`…).
  const PAGINA = new Set(['wc', 'pwc', 'webContents', 'contents']);
  const eseguono = file.filter((f) => !ECCEZIONI.has(f)
    && [...readFileSync(join(ROOT, f), 'utf8').matchAll(/\b([A-Za-z_$][\w$]*)\.executeJavaScript(?:InIsolatedWorld)?\(/g)]
      .some((m) => !PAGINA.has(m[1])));
  assert.ok(eseguono.length >= 4, `la ricerca non trova più chi esegue nei riquadri: ${eseguono.join(', ')}`);
  for (const f of eseguono) assert.match(readFileSync(join(ROOT, f), 'utf8'), /riquadroArrivato/, `${f} esegue in un riquadro forse ancora in arrivo`);
});

test('lato main: i campi segreti nei riquadri non toccano un riquadro in arrivo, e coprono quelli arrivati', async () => {
  require('../../src/shared/guardianoStatico.js');
  require('../../src/shared/campiSegreti.js');
  const { campiSegretiNeiRiquadri } = require('../../src/main/services/campiNeiRiquadri.js');
  const toccati = [];
  const CAMPO = { left: 5, top: 5, width: 10, height: 10 };
  const frame = (nome, url, parent) => {
    const f = { nome, url, parent, detached: false, top: parent ? parent.top : null };
    f.executeJavaScript = async (codice) => {
      toccati.push(nome);
      if (codice === '0') return 0;
      if (codice.startsWith('new Promise')) return { left: 100, top: 200, width: 300, height: 300 };
      if (codice.startsWith('parent.postMessage')) return undefined;
      return [CAMPO];
    };
    if (!parent) f.top = f;
    return f;
  };
  const pagina = (...riquadri) => {
    const mainFrame = riquadri[0].top;
    mainFrame.framesInSubtree = [mainFrame, ...riquadri];
    return { mainFrame };
  };

  const top = frame('pagina', 'https://esempio.test/', null);
  const carta = frame('carta', 'https://carta.test/', top);
  const inArrivo = frame('in arrivo', '', top);
  const r1 = await campiSegretiNeiRiquadri(pagina(carta, inArrivo));
  assert.ok(!toccati.includes('in arrivo'), 'il riquadro senza documento non si esegue');
  assert.equal(r1.nonCoperti, false);
  assert.deepEqual(r1.campi.map((c) => [c.left, c.top]), [[105, 205]], 'il campo del riquadro arrivato resta coperto');

  toccati.length = 0;
  const genitore = frame('genitore in arrivo', '', top);
  const nipote = frame('nipote', 'https://carta.test/', genitore);
  const r2 = await campiSegretiNeiRiquadri(pagina(genitore, nipote));
  assert.ok(!toccati.includes('genitore in arrivo'), 'il genitore senza documento non si esegue');
  assert.equal(r2.nonCoperti, true, 'senza la misura del genitore la foto non parte');
});
