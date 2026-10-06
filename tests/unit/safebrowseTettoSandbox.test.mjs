// Le finestre nascoste della sandbox anti-phishing hanno un tetto (#591): quante vivono insieme, quante aspettano in
// coda e quanto vive ognuna. Giudizio del modello e sandbox valgono per il dominio registrabile: sottodomini sempre
// nuovi non li fanno ripartire. Regole in src/main/services/safebrowse/sandbox.js e index.js.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { scorri, inAttesa } from '../helpers/orologio.mjs';

const require = createRequire(import.meta.url);
const { createDetonator, MAX_CONCURRENT, MAX_LIFETIME_MS } = require('../../src/main/services/safebrowse/sandbox.js');
const SB = require('../../src/main/services/safebrowse/index.js');

// Electron finto: conta le finestre vive e lascia decidere al test cosa fa la pagina dopo loadURL.
function electronFinto(pagina = () => {}) {
  const vive = new Set();
  let picco = 0;
  let aperte = 0;
  class BrowserWindow {
    constructor() {
      aperte++;
      const ascolti = {};
      this.distrutta = false;
      this.webContents = {
        on: (ev, fn) => { (ascolti[ev] = ascolti[ev] || []).push(fn); },
        setWindowOpenHandler() {},
        loadURL: (url) => {
          setTimeout(() => pagina((ev, ...a) => (ascolti[ev] || []).forEach((f) => f({}, ...a)), url), 1);
          return Promise.resolve();
        },
      };
      vive.add(this);
      picco = Math.max(picco, vive.size);
    }
    isDestroyed() { return this.distrutta; }
    destroy() { this.distrutta = true; vive.delete(this); }
  }
  const session = { fromPartition: () => ({ on() {}, clearStorageData: async () => {} }) };
  return { electron: { BrowserWindow, session }, conta: () => ({ vive: vive.size, picco, aperte }) };
}

test('i valori di fabbrica tengono poche finestre insieme e una vita breve', () => {
  assert.ok(MAX_CONCURRENT >= 1 && MAX_CONCURRENT <= 4);
  assert.ok(MAX_LIFETIME_MS > 0 && MAX_LIFETIME_MS <= 60_000);
});

test('dieci link sospetti insieme: mai più finestre nascoste del tetto, gli altri aspettano in coda e passano tutti', async () => {
  const f = electronFinto(); // pagina che non finisce mai di caricare
  const D = createDetonator({ electron: f.electron, maxConcurrent: 2, maxQueue: 20, loadTimeoutMs: 20, maxLifetimeMs: 200 });
  const esiti = await Promise.all(Array.from({ length: 10 }, (_, i) => D.detonate(`http://s${i}.esempio.xyz/`)));
  assert.equal(f.conta().picco, 2);
  assert.equal(f.conta().aperte, 10);
  assert.equal(f.conta().vive, 0, 'nessuna finestra resta aperta');
  assert.ok(esiti.every((e) => e && e.verdict === 'clean'));
  assert.deepEqual(D.stats(), { live: 0, queued: 0 });
});

test('una pagina che tiene occupata la finestra dopo il caricamento muore comunque alla vita massima', async () => {
  // Rimanda altrove e poi finisce di caricare: la ri-valutazione dell'indirizzo finale non risponde mai.
  const f = electronFinto((emetti) => {
    emetti('did-navigate', 'http://altrove.esempio.xyz/');
    emetti('did-stop-loading');
  });
  // Orologio finto: muore allo scadere della vita massima, non «entro un tempo» di una macchina magari carica (#1063).
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const D = createDetonator({ electron: f.electron, maxConcurrent: 1, loadTimeoutMs: 10_000, maxLifetimeMs: 60 });
    const esito = inAttesa(D.detonate('http://s.esempio.xyz/', () => new Promise(() => {})));
    await scorri(1);
    await scorri(58);
    assert.equal(esito.fatto, false, 'la pagina è caricata e la ri-valutazione non risponde: vive ancora');
    await scorri(1);
    assert.equal(esito.fatto, true, 'alla vita massima muore');
    assert.equal(esito.valore.expired, true);
    assert.equal(f.conta().vive, 0);
  } finally {
    mock.timers.reset();
  }
});

test('a coda piena un link nuovo non apre niente e torna subito senza verdetto', async () => {
  const f = electronFinto();
  const D = createDetonator({ electron: f.electron, maxConcurrent: 1, maxQueue: 2, loadTimeoutMs: 20, maxLifetimeMs: 100 });
  const tutti = Array.from({ length: 5 }, (_, i) => D.detonate(`http://q${i}.esempio.xyz/`));
  assert.deepEqual(D.stats(), { live: 1, queued: 2 });
  const esiti = await Promise.all(tutti);
  assert.equal(esiti.filter((e) => e === null).length, 2);
  assert.equal(f.conta().aperte, 3);
  assert.equal(f.conta().picco, 1);
});

test('sottodomini sempre nuovi dello stesso dominio: qualche giudizio del modello e qualche sandbox all\'ora, non uno per sottodominio', async () => {
  let giudizi = 0;
  let sandbox = 0;
  for (const c of Object.values(SB._caches)) c.m.clear();
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => { giudizi++; await new Promise((ok) => setTimeout(ok, 5)); return { suspicious: false, reason: null }; },
    sandbox: async () => { sandbox++; await new Promise((ok) => setTimeout(ok, 5)); return { verdict: 'clean', redirects: [] }; },
  });
  try {
    const giro = (n) => Promise.all(Array.from({ length: n }, (_, i) => new Promise((ok) => {
      const url = `http://x${Math.random().toString(36).slice(2)}${i}.esempio-ostile.com/`;
      const v = SB.analyze(url, {}, ok);
      assert.equal(v.needsLlm, true, url);
      setTimeout(ok, 50);
    })));
    await giro(20);  // tutti insieme, mentre il primo giudizio è ancora in volo
    await giro(20);  // e dopo, a giudizio già in memoria
    assert.equal(giudizi, SB.DEEP_BUDGET);
    assert.equal(sandbox, SB.DEEP_BUDGET);
    // Un altro dominio ha il suo conto.
    await giro(1);
    SB.analyze('http://a.altro-dominio.com/', {}, () => {});
    await new Promise((ok) => setTimeout(ok, 30));
    assert.equal(giudizi, SB.DEEP_BUDGET + 1);
  } finally {
    SB.setProviders({ llm: null, sandbox: null });
    for (const c of Object.values(SB._caches)) c.m.clear();
  }
});

test('le memorie isolate delle finestre nascoste si riusano: tante quanti i posti, qualunque sia il numero di controlli', async () => {
  const memorie = new Map();
  class BrowserWindow {
    constructor() {
      const ascolti = {};
      this.webContents = {
        on: (ev, fn) => { (ascolti[ev] = ascolti[ev] || []).push(fn); },
        setWindowOpenHandler() {},
        loadURL: () => { setTimeout(() => (ascolti['did-stop-loading'] || []).forEach((f) => f({})), 1); return Promise.resolve(); },
      };
    }
    isDestroyed() { return false; }
    destroy() {}
  }
  const session = {
    fromPartition: (nome) => {
      if (!memorie.has(nome)) {
        const ascolti = new Set();
        memorie.set(nome, { ascolti, on: (_ev, fn) => ascolti.add(fn), removeListener: (_ev, fn) => ascolti.delete(fn), clearStorageData: async () => {} });
      }
      return memorie.get(nome);
    },
  };
  const D = createDetonator({ electron: { BrowserWindow, session }, maxConcurrent: 2, loadTimeoutMs: 50, maxLifetimeMs: 100 });
  await Promise.all(Array.from({ length: 12 }, (_, i) => D.detonate(`http://s${i}.esempio.xyz/`)));
  assert.equal(memorie.size, 2);
  for (const m of memorie.values()) assert.equal(m.ascolti.size, 0, 'nessun ascolto dei download resta attaccato fra un controllo e l\'altro');
  assert.deepEqual(D.stats(), { live: 0, queued: 0 });
});
