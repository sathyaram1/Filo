// Le finestre nascoste della sandbox anti-phishing hanno un tetto (#591): quante vivono insieme, quante aspettano in
// coda e quanto vive ognuna. Giudizio del modello e sandbox valgono per il dominio registrabile: sottodomini sempre
// nuovi non li fanno ripartire. Regole in src/main/services/safebrowse/sandbox.js e index.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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
  const D = createDetonator({ electron: f.electron, maxConcurrent: 1, loadTimeoutMs: 10_000, maxLifetimeMs: 60 });
  const t0 = Date.now();
  const r = await D.detonate('http://s.esempio.xyz/', () => new Promise(() => {}));
  assert.equal(r.expired, true);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(f.conta().vive, 0);
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

test('sottodomini sempre nuovi dello stesso dominio: un solo giudizio del modello e una sola sandbox', async () => {
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
    assert.equal(giudizi, 1);
    assert.equal(sandbox, 1);
    // Un altro dominio ha il suo giudizio.
    await giro(1);
    SB.analyze('http://a.altro-dominio.com/', {}, () => {});
    await new Promise((ok) => setTimeout(ok, 30));
    assert.equal(giudizi, 2);
  } finally {
    SB.setProviders({ llm: null, sandbox: null });
    for (const c of Object.values(SB._caches)) c.m.clear();
  }
});
