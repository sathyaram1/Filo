// Il puntatore fermo su un link accorciato o di rimando ne prepara il verdetto prima del clic (#966). Solo quei link
// mandano qualcosa in rete prima del clic; la finestra nascosta è una alla volta e si ferma alla destinazione; col dito
// e in incognito resta il controllo all'apertura. Codice: src/main/services/safebrowse/{rimandi,index,sandbox}.js e
// src/main/tabs/tabSafebrowse.js; il percorso vero in tests/safebrowse-link-accorciati.spec.mjs.

import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { scorri, svuota } from '../helpers/orologio.mjs';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');
const { createDetonator, MAX_CONCURRENT, VITA_DESTINAZIONE_MS } = require('../../src/main/services/safebrowse/sandbox.js');
const { installSafebrowse } = require('../../src/main/tabs/tabSafebrowse.js');

globalThis.SN_SAFEBROWSE = SB;

const DEST = 'https://conto-truffa.example-qualunque.com/accesso';
let chiesto;
function fornitori({ inLista = [], destinazione = DEST, gsb = true, finestra = true } = {}) {
  chiesto = { gsb: [], finestra: [] };
  for (const c of Object.values(SB._caches)) c.m.clear();
  SB.setProviders({
    gsb: gsb ? async (u) => { chiesto.gsb.push(u); return { listed: inLista.some((x) => u.startsWith(x)), category: 'phishing' }; } : null,
    gsbPeek: null, rdap: null, ct: null, llm: null, sandbox: null,
    destinazione: finestra ? async (u) => { chiesto.finestra.push(u); return destinazione ? { destinazione, passi: [u, destinazione] } : { destinazione: null, passi: [u] }; } : null,
  });
}
beforeEach(() => fornitori());

test('accorciati e rimandi noti si riconoscono; la radice dell\'accorciatore, i siti dei marchi e i link qualunque no', () => {
  for (const u of ['https://bit.ly/3xYz', 'http://tinyurl.com/abc', 'https://t.co/AbC123', 'https://lnkd.in/dXyz', 'https://www.bit.ly/x',
    'https://us5.list-manage.com/track/click?u=1&id=2&e=3']) {
    assert.deepEqual(SB.tipoLink(u), { tipo: 'accorciato' }, u);
  }
  const rimandi = {
    'https://www.google.com/url?q=https%3A%2F%2Fmeta.esempio.com%2Fa%3Fb%3D1&sa=D': 'https://meta.esempio.com/a?b=1',
    'https://www.google.it/url?sa=t&url=https://meta.esempio.com/': 'https://meta.esempio.com/',
    'https://l.facebook.com/l.php?u=https%3A%2F%2Fmeta.esempio.com%2F&h=AT0': 'https://meta.esempio.com/',
    'https://www.youtube.com/redirect?event=video&q=https%3A%2F%2Fmeta.esempio.com%2F': 'https://meta.esempio.com/',
    'https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fmeta.esempio.com%2F&data=x': 'https://meta.esempio.com/',
    'https://urldefense.proofpoint.com/v2/url?u=https-3A__meta.esempio.com_a&d=x': 'https://meta.esempio.com/a',
    'https://urldefense.com/v3/__https://meta.esempio.com/a__;!!x': 'https://meta.esempio.com/a',
  };
  for (const [u, d] of Object.entries(rimandi)) assert.deepEqual(SB.tipoLink(u), { tipo: 'rimando', destinazione: d }, u);
  for (const u of ['https://bit.ly/', 'https://youtu.be/abc', 'https://amzn.to/abc', 'https://www.google.com/search?q=bit.ly',
    'https://www.google.com/url?q=javascript:alert(1)', 'javascript:location="https://bit.ly/x"', 'https://esempio.com/bit.ly/x',
    'https://l.facebook.com/l.php', 'mailto:a@bit.ly', '', 'non un link']) {
    assert.equal(SB.tipoLink(u), null, u);
  }
});

test('un link qualunque non manda niente in rete prima del clic', async () => {
  assert.equal(SB.preverifica('https://www.esempio-qualunque.com/pagina', { pagina: 'https://sito.com/' }), null);
  await SB._settled();
  assert.deepEqual(chiesto, { gsb: [], finestra: [] });
});

test('accorciato: lista nera sul link, finestra nascosta per la destinazione, lista nera sulla destinazione; una volta sola', async () => {
  fornitori({ inLista: ['https://conto-truffa.'] });
  const link = 'https://bit.ly/3xYz';
  const voce = await SB.preverifica(link, { pagina: 'https://sito.com/' });
  assert.equal(voce.destinazione, DEST);
  assert.deepEqual(chiesto.finestra, [link]);
  assert.deepEqual(chiesto.gsb.sort(), [DEST, link].sort());
  assert.equal(voce.verdetto.level, 'pericoloso');
  assert.match(voce.verdetto.message.body, /example-qualunque\.com/);
  assert.equal(SB.preverdetto(link), voce);
  await SB.preverifica(link, { pagina: 'https://sito.com/' });
  assert.equal(chiesto.finestra.length, 1, 'ripassandoci sopra non si riapre niente');
});

test('rimando con la destinazione scritta nel link: niente finestra nascosta', async () => {
  const link = 'https://www.google.com/url?q=' + encodeURIComponent(DEST);
  const voce = await SB.preverifica(link, {});
  assert.equal(voce.destinazione, DEST);
  assert.deepEqual(chiesto.finestra, []);
  assert.deepEqual(chiesto.gsb.sort(), [DEST, link].sort());
});

test('rimando che porta a un accorciato: si legge il primo, si apre solo il secondo', async () => {
  const link = 'https://l.facebook.com/l.php?u=' + encodeURIComponent('https://bit.ly/abc');
  const voce = await SB.preverifica(link, {});
  assert.deepEqual(chiesto.finestra, ['https://bit.ly/abc']);
  assert.deepEqual(voce.passi, [link, 'https://bit.ly/abc', DEST]);
});

test('il link stesso in lista nera, la destinazione no: il link è pericoloso e lo dice', async () => {
  fornitori({ inLista: ['https://bit.ly/3xYz'] });
  const voce = await SB.preverifica('https://bit.ly/3xYz', {});
  assert.equal(voce.verdetto.level, 'pericoloso');
  assert.equal(voce.verdetto.message.title, 'Link segnalato come pericoloso');
  assert.match(voce.verdetto.message.body, /bit\.ly\/3xYz/);
});

test('in incognito la lista nera sì, la finestra nascosta no', async () => {
  const voce = await SB.preverifica('https://bit.ly/3xYz', { incognito: true });
  assert.deepEqual(chiesto.finestra, []);
  assert.deepEqual(chiesto.gsb, ['https://bit.ly/3xYz']);
  assert.equal(voce.destinazione, null);
  // Lo stesso link poi in una finestra normale: la destinazione si cerca adesso.
  const dopo = await SB.preverifica('https://bit.ly/3xYz', {});
  assert.deepEqual(chiesto.finestra, ['https://bit.ly/3xYz']);
  assert.equal(dopo.destinazione, DEST);
});

test('rilevatore spento: niente parte; finestra spenta: solo la lista nera', async () => {
  fornitori({ gsb: false, finestra: false });
  assert.equal(SB.preverifica('https://bit.ly/3xYz', {}), null);
  fornitori({ finestra: false });
  await SB.preverifica('https://bit.ly/3xYz', {});
  assert.deepEqual(chiesto, { gsb: ['https://bit.ly/3xYz'], finestra: [] });
});

test('una pagina che cambia i link sotto il puntatore arriva al tetto per ora del suo sito, e lo scrive', async () => {
  const avvisi = mock.method(console, 'warn', () => {});
  try {
    for (let i = 0; i < SB.PRE_PER_ORA; i++) assert.ok(SB.preverifica(`https://bit.ly/x${i}`, { pagina: 'https://ostile.example.com/' }));
    assert.equal(SB.preverifica('https://bit.ly/oltre', { pagina: 'https://ostile.example.com/' }), null);
    assert.ok(avvisi.mock.calls.some((c) => /si controlla all'apertura/.test(String(c.arguments[0]))));
    assert.ok(SB.preverifica('https://bit.ly/oltre', { pagina: 'https://altro.example-diverso.org/' }), 'un altro sito ha il suo conto');
    await SB._settled();
  } finally {
    avvisi.mock.restore();
  }
});

// Electron finto: la pagina dell'accorciatore la recita il test con gli eventi che manda dopo loadURL.
function electronFinto(pagina) {
  const vive = new Set();
  let picco = 0;
  const fermati = [];
  class BrowserWindow {
    constructor() {
      const ascolti = {};
      const emetti = (ev, ...a) => {
        const e = { url: a[0], preventDefault: () => fermati.push(a[0]) };
        (ascolti[ev] || []).forEach((f) => f(e, ...a));
      };
      this.webContents = {
        on: (ev, fn) => { (ascolti[ev] = ascolti[ev] || []).push(fn); },
        setWindowOpenHandler() {},
        loadURL: (url) => { setTimeout(() => pagina(emetti, url), 1); return Promise.resolve(); },
      };
      vive.add(this);
      picco = Math.max(picco, vive.size);
    }
    isDestroyed() { return !vive.has(this); }
    destroy() { vive.delete(this); }
  }
  const session = { fromPartition: () => ({ on() {}, clearStorageData: async () => {} }) };
  return { electron: { BrowserWindow, session }, conta: () => ({ vive: vive.size, picco }), fermati };
}
const prosegue = SB.rimandi.siApre;

test('di fabbrica una sola finestra nascosta alla volta, che vive pochi secondi', () => {
  assert.equal(MAX_CONCURRENT, 1);
  assert.ok(VITA_DESTINAZIONE_MS > 0 && VITA_DESTINAZIONE_MS <= 10_000);
});

test('la finestra segue i rimandi e si ferma PRIMA della destinazione, che non riceve visite', async () => {
  const f = electronFinto((emetti) => {
    emetti('will-redirect', 'https://bit.ly/3xYz');
    emetti('will-redirect', 'https://tinyurl.com/ab');
    emetti('will-redirect', DEST);
  });
  const D = createDetonator({ electron: f.electron });
  const r = await D.destinazione('http://bit.ly/3xYz', prosegue);
  assert.equal(r.destinazione, DEST);
  assert.deepEqual(r.passi, ['http://bit.ly/3xYz', 'https://bit.ly/3xYz', 'https://tinyurl.com/ab', DEST]);
  assert.deepEqual(f.fermati, [DEST], 'la navigazione verso la destinazione è annullata');
  assert.equal(f.conta().vive, 0);
});

test('un rimando che scrive la destinazione ferma la finestra: lo si legge, non lo si visita', async () => {
  const google = 'https://www.google.com/url?q=' + encodeURIComponent(DEST);
  const f = electronFinto((emetti) => emetti('will-redirect', google));
  const r = await createDetonator({ electron: f.electron }).destinazione('https://bit.ly/3xYz', prosegue);
  assert.equal(r.destinazione, google);
  assert.deepEqual(f.fermati, [google]);
  fornitori({ destinazione: google });
  const voce = await SB.preverifica('https://bit.ly/3xYz', {});
  assert.equal(voce.destinazione, DEST, 'la destinazione scritta nel rimando');
});

test('un accorciato che rimanda da script si ferma uguale; uno che non rimanda chiude la finestra senza destinazione', async () => {
  const js = electronFinto((emetti) => { emetti('did-stop-loading'); setTimeout(() => emetti('will-navigate', DEST), 5); });
  const r = await createDetonator({ electron: js.electron }).destinazione('https://t.co/abc', prosegue);
  assert.equal(r.destinazione, DEST);
  assert.deepEqual(js.fermati, [DEST]);

  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const morto = electronFinto((emetti) => emetti('did-stop-loading'));
    let esito = null;
    createDetonator({ electron: morto.electron, attesaRimandoMs: 100 }).destinazione('https://bit.ly/morto', prosegue).then((x) => { esito = x; });
    await scorri(1);
    await scorri(99);
    assert.equal(esito, null, 'aspetta un rimando da script');
    await scorri(1);
    assert.equal(esito && esito.destinazione, null);
    assert.equal(morto.conta().vive, 0);
  } finally {
    mock.timers.reset();
  }
});

test('un link più recente prende il posto: la finestra di quello prima si chiude, e ce n\'è sempre una sola', async () => {
  const f = electronFinto(() => {}); // accorciatori che non rispondono mai
  const D = createDetonator({ electron: f.electron, vitaDestinazioneMs: 60_000 });
  const primo = D.destinazione('https://bit.ly/uno', prosegue);
  await svuota();
  const secondo = D.destinazione('https://bit.ly/due', prosegue);
  const terzo = D.destinazione('https://bit.ly/tre', prosegue);
  assert.equal((await primo).annullato, true);
  assert.equal(await secondo, null, 'quello in coda lascia il posto senza aprire niente');
  await svuota();
  assert.deepEqual([f.conta().vive, f.conta().picco], [1, 1]);
  D.destinazione('https://bit.ly/quattro', prosegue);
  assert.equal((await terzo).annullato, true);
});

// Una finestra di Filo finta con una scheda, i cui webContents emettono gli eventi che il test recita.
function finestra({ incognito = false } = {}) {
  class Schede {}
  installSafebrowse(Schede);
  const schede = new Schede();
  schede.incognito = incognito;
  schede.activeId = 1;
  schede.layout = () => {};
  const ascolti = {};
  const pagina = { url: 'https://sito.com/pagina' };
  const wc = {
    on: (ev, fn) => { (ascolti[ev] = ascolti[ev] || []).push(fn); },
    once: (ev, fn) => { (ascolti[ev] = ascolti[ev] || []).push(fn); },
    getURL: () => pagina.url, isDestroyed: () => false, send() {},
  };
  const emetti = (ev, ...a) => (ascolti[ev] || []).forEach((f) => f({}, ...a));
  const tab = { id: 1, view: { webContents: wc } };
  schede.tabs = [tab];
  const chiesti = [];
  schede._sbPreverifica = (url, p) => { chiesti.push([url, p]); };
  schede._sbSeguiPuntatore(tab, wc);
  return { schede, tab, pagina, emetti, chiesti };
}

test('mezzo secondo fermo su un link accorciato raggiunto col mouse: parte il controllo, una volta', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const f = finestra();
    f.emetti('input-event', { type: 'mouseMove' });
    f.emetti('update-target-url', 'https://bit.ly/3xYz');
    await scorri(499);
    assert.deepEqual(f.chiesti, []);
    await scorri(1);
    assert.deepEqual(f.chiesti, [['https://bit.ly/3xYz', 'https://sito.com/pagina']]);
  } finally {
    mock.timers.reset();
  }
});

test('niente controllo prima del clic: passaggio veloce, link qualunque, clic prima del tempo, dito, link cambiato da una pagina sotto il mouse fermo', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const casi = {
      veloce: (f) => { f.emetti('input-event', { type: 'mouseMove' }); f.emetti('update-target-url', 'https://bit.ly/a'); return 300; },
      qualunque: (f) => { f.emetti('input-event', { type: 'mouseMove' }); f.emetti('update-target-url', 'https://esempio.com/a'); return 0; },
      clic: (f) => { f.emetti('input-event', { type: 'mouseMove' }); f.emetti('update-target-url', 'https://bit.ly/a'); f.emetti('input-event', { type: 'mouseDown' }); return 0; },
      dito: (f) => { f.emetti('input-event', { type: 'touchStart' }); f.emetti('input-event', { type: 'gestureTap' }); f.emetti('update-target-url', 'https://bit.ly/a'); return 0; },
      paginaSottoIlMouseFermo: async (f) => { f.emetti('input-event', { type: 'mouseMove' }); await scorri(5000); f.emetti('update-target-url', 'https://bit.ly/a'); return 0; },
    };
    for (const [nome, recita] of Object.entries(casi)) {
      const f = finestra();
      const prima = await recita(f);
      if (prima) { await scorri(prima); f.emetti('update-target-url', ''); }
      await scorri(2000);
      assert.deepEqual(f.chiesti, [], nome);
    }
    // Col Tab il link arriva da un tasto vero: vale come il puntatore.
    const f = finestra();
    f.emetti('input-event', { type: 'rawKeyDown', key: 'Tab' });
    f.emetti('update-target-url', 'https://bit.ly/a');
    await scorri(500);
    assert.equal(f.chiesti.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('la pagina fatta scorrere dall\'utente porta un accorciato sotto il puntatore fermo: parte il controllo, una volta', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const casi = {
      rotella: (f) => { f.emetti('input-event', { type: 'mouseWheel' }); f.emetti('update-target-url', 'https://bit.ly/a'); },
      touchpad: (f) => { f.emetti('input-event', { type: 'gestureScrollUpdate' }); f.emetti('update-target-url', 'https://bit.ly/a'); },
      tastoFine: (f) => { f.emetti('input-event', { type: 'rawKeyDown', key: 'End' }); f.emetti('update-target-url', 'https://bit.ly/a'); },
      // Il link era arrivato senza gesto recente: il primo movimento sullo stesso link fa partire la sosta.
      gestoDopo: async (f) => { f.emetti('update-target-url', 'https://bit.ly/a'); await scorri(3000); f.emetti('input-event', { type: 'mouseMove' }); },
    };
    for (const [nome, recita] of Object.entries(casi)) {
      const f = finestra();
      await recita(f);
      await scorri(499);
      assert.deepEqual(f.chiesti, [], nome);
      await scorri(1);
      f.emetti('input-event', { type: 'mouseMove' });
      f.emetti('input-event', { type: 'mouseWheel' });
      await scorri(2000);
      assert.deepEqual(f.chiesti, [['https://bit.ly/a', 'https://sito.com/pagina']], nome);
    }
    // Col dito lo scorrimento non vale: resta il controllo all'apertura.
    const f = finestra();
    f.emetti('input-event', { type: 'touchStart' });
    f.emetti('input-event', { type: 'gestureScrollUpdate' });
    f.emetti('update-target-url', 'https://bit.ly/a');
    f.emetti('input-event', { type: 'gestureScrollEnd' });
    await scorri(2000);
    assert.deepEqual(f.chiesti, []);
  } finally {
    mock.timers.reset();
  }
});

test('in incognito la porta della scheda chiede il controllo senza finestra nascosta', () => {
  class Schede {}
  installSafebrowse(Schede);
  const s = new Schede();
  s.incognito = true;
  const presi = [];
  const prima = globalThis.SN_SAFEBROWSE;
  globalThis.SN_SAFEBROWSE = { preverifica: (u, ctx) => { presi.push([u, ctx]); return null; } };
  try {
    s._sbPreverifica('https://bit.ly/a', 'https://sito.com/');
  } finally {
    globalThis.SN_SAFEBROWSE = prima;
  }
  assert.deepEqual(presi, [['https://bit.ly/a', { pagina: 'https://sito.com/', incognito: true, rete: null }]]);
});

// #753.1 — da una scheda aperta da un altro paese la finestra nascosta esce dallo stesso proxy, credenziali comprese.
test('da una scheda col proxy la porta passa alla finestra nascosta la rete della scheda', () => {
  class Schede {}
  installSafebrowse(Schede);
  const s = new Schede();
  const ProxyTab = require('../../src/main/services/proxyTab.js');
  const proxata = { nome: 'sessione proxata' };
  const normale = { nome: 'sessione normale' };
  ProxyTab.registraRete('proxy:prova', proxata, { proxyRules: 'socks5://1.2.3.4:1080', bypassRules: '<-loopback>', auth: { username: 'u', password: 'p' } });
  const presi = [];
  const prima = globalThis.SN_SAFEBROWSE;
  globalThis.SN_SAFEBROWSE = { preverifica: (u, ctx) => { presi.push(ctx.rete); return null; } };
  try {
    s._sbPreverifica('https://bit.ly/a', 'https://sito.com/', proxata);
    s._sbPreverifica('https://bit.ly/a', 'https://sito.com/', normale);
  } finally {
    globalThis.SN_SAFEBROWSE = prima;
    ProxyTab.clearPartitionAuth('proxy:prova');
  }
  assert.deepEqual(presi, [
    { proxyRules: 'socks5://1.2.3.4:1080', proxyBypassRules: '<-loopback>', auth: { username: 'u', password: 'p' } },
    null,
  ]);
});

test('al clic sul link controllato la pagina d\'arrivo ha subito il suo avviso; «confermo» lo toglie; una navigazione nuova non lo eredita', async () => {
  fornitori({ inLista: ['https://bit.ly/3xYz'], destinazione: 'https://pulito.example-qualunque.com/' });
  await SB.preverifica('https://bit.ly/3xYz', {});
  const f = finestra();
  const arrivo = 'https://pulito.example-qualunque.com/';
  f.emetti('did-start-navigation', 'https://bit.ly/3xYz', false, true);
  f.emetti('did-redirect-navigation', arrivo, false, true);
  f.pagina.url = arrivo;
  f.schede._sbOnNavigate(f.tab, arrivo);
  assert.equal(f.tab.sbAvviso && f.tab.sbAvviso.level, 'pericoloso');
  assert.equal(f.tab.sbAvviso.message.title, 'Link segnalato come pericoloso');
  assert.equal(f.tab.sbAvviso.url, arrivo);
  // Il content script chiede il verdetto della pagina dopo: l'avviso resta.
  assert.equal(f.schede.safebrowseGet(1, arrivo, {}).level, 'pericoloso');
  f.schede.safebrowseProceed(1, arrivo);
  assert.equal(f.tab.sbAvviso, null);
  assert.equal(f.schede.safebrowseGet(1, arrivo, {}).level, 'safe', 'la conferma vale per il sito della pagina');
  // Un'altra pagina, raggiunta senza passare dal link: nessuna eredità.
  const g = finestra();
  g.emetti('did-start-navigation', 'https://bit.ly/3xYz', false, true);
  g.emetti('did-start-navigation', arrivo, false, true);
  g.pagina.url = arrivo;
  g.schede._sbOnNavigate(g.tab, arrivo);
  assert.equal(g.tab.sbAvviso, null);
  await SB._settled();
});

test('cliccato mentre il controllo è ancora in corso: l\'avviso arriva appena il controllo finisce', async () => {
  const attese = new Map();
  fornitori({ destinazione: null });
  SB.setProviders({ gsb: (u) => new Promise((ok) => { attese.set(u, () => ok({ listed: u.includes('bit.ly'), category: 'malware' })); }) });
  const inCorso = SB.preverifica('https://bit.ly/lento', {});
  const f = finestra();
  const arrivo = 'https://pulito.example-qualunque.com/';
  f.emetti('did-start-navigation', 'https://bit.ly/lento', false, true);
  f.pagina.url = arrivo;
  f.schede._sbOnNavigate(f.tab, arrivo);
  assert.equal(f.tab.sbAvviso, null);
  await svuota();
  for (const rispondi of attese.values()) rispondi();
  await inCorso;
  await svuota();
  assert.equal(f.tab.sbAvviso && f.tab.sbAvviso.level, 'pericoloso');
});
