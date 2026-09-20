// Tetto alle finestre nascoste del rilevatore di siti pericolosi (#591).
//
// Il controllo più profondo apre il link in una finestra nascosta con
// JavaScript attivo. Di quelle finestre non c'era né un tetto al numero né uno
// al tempo di vita: l'unico freno era una cache per host, e bastavano
// sottodomini sempre nuovi per aggirarla. Il tempo di vita poi era peggio di
// quanto sembrasse — il timer di attesa veniva ANNULLATO appena la pagina
// finiva di caricare, e se la valutazione dell'URL finale non tornava più, la
// finestra restava aperta per tutta la sessione.
//
// Qui si prova quello che non dipende da Electron: il tetto di concorrenza con
// la sua coda, e il fatto che una finestra venga distrutta comunque.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const require_ = createRequire(import.meta.url);

const sandbox = require_(join(REPO, 'src/main/services/safebrowse/sandbox.js'));
const safebrowse = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Il tetto di concorrenza, da solo ───────────────────────────────────────

test('non girano più compiti del tetto: gli altri aspettano in coda', async () => {
  const gate = sandbox.createConcurrencyGate({ maxConcurrent: 2, maxQueue: 10, maxWaitMs: 5000 });
  let insieme = 0;
  let picco = 0;
  const sblocca = [];
  const corse = [];
  for (let i = 0; i < 6; i++) {
    corse.push(gate.run(() => new Promise((res) => {
      insieme++;
      picco = Math.max(picco, insieme);
      sblocca.push(() => { insieme--; res(i); });
    })));
  }
  await attendi(10);
  assert.equal(picco, 2, 'al massimo due finestre insieme');
  assert.equal(gate.queued, 4, 'le altre quattro aspettano');
  while (sblocca.length) sblocca.shift()();
  // Ogni rilascio fa partire uno di quelli in coda: si svuota a ondate.
  for (let g = 0; g < 6; g++) { await attendi(5); while (sblocca.length) sblocca.shift()(); }
  const esiti = await Promise.all(corse);
  assert.equal(esiti.filter((e) => !e.refused).length, 6, 'nessuno perso per strada');
  assert.equal(picco, 2, 'il tetto ha retto per tutta la coda');
});

test('la coda ha un fondo: oltre quello si rinuncia subito', async () => {
  const gate = sandbox.createConcurrencyGate({ maxConcurrent: 1, maxQueue: 2, maxWaitMs: 5000 });
  const sblocca = [];
  const corse = [];
  for (let i = 0; i < 5; i++) {
    corse.push(gate.run(() => new Promise((res) => sblocca.push(res))));
  }
  await attendi(10);
  assert.equal(gate.queued, 2, 'la coda si ferma al suo fondo');
  const esiti = await Promise.all(corse.slice(3));
  assert.ok(esiti.every((e) => e.refused && e.reason === 'queue_full'),
    'chi arriva a coda piena riceve un rifiuto, non un posto');
  while (sblocca.length) sblocca.shift()();
  for (let g = 0; g < 4; g++) { await attendi(5); while (sblocca.length) sblocca.shift()(); }
});

test('chi aspetta troppo in coda rinuncia invece di restare appeso', async () => {
  const gate = sandbox.createConcurrencyGate({ maxConcurrent: 1, maxQueue: 5, maxWaitMs: 30 });
  let sbloccaPrimo = null;
  const primo = gate.run(() => new Promise((res) => { sbloccaPrimo = res; }));
  const secondo = gate.run(async () => 'mai');
  const esito = await secondo;
  assert.equal(esito.refused, true);
  assert.equal(esito.reason, 'queue_timeout');
  sbloccaPrimo('fatto');
  await primo;
});

// ─── La finestra vera (Electron finto) ──────────────────────────────────────

// Electron minimo: conta quante finestre esistono insieme e registra chi viene
// distrutto. La pagina non finisce MAI di caricare, così l'unica cosa che può
// chiudere la finestra è il tetto di vita.
function electronFinto() {
  const state = { aperte: 0, picco: 0, create: 0, distrutte: 0 };
  class FakeWebContents {
    on() {}
    setWindowOpenHandler() {}
    loadURL() { return new Promise(() => {}); } // non si risolve mai
  }
  class FakeBrowserWindow {
    constructor() {
      state.create++;
      state.aperte++;
      state.picco = Math.max(state.picco, state.aperte);
      this.destroyed = false;
      this.webContents = new FakeWebContents();
    }
    isDestroyed() { return this.destroyed; }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      state.aperte--;
      state.distrutte++;
    }
  }
  return {
    state,
    BrowserWindow: FakeBrowserWindow,
    session: {
      fromPartition: () => ({ on() {}, clearStorageData: () => Promise.resolve() }),
    },
  };
}

test('una finestra nascosta viene distrutta comunque, anche se la pagina non finisce mai', async () => {
  const el = electronFinto();
  const r = await sandbox.detonate('http://esempio.test/x', () => new Promise(() => {}), {
    electron: el, timeoutMs: 5000, hardLifetimeMs: 40,
  });
  assert.equal(r, null, 'senza verdetto: non si finge un "pulito" che nessuno ha stabilito');
  assert.equal(el.state.aperte, 0, 'la finestra non resta viva');
  assert.equal(el.state.distrutte, 1);
});

test('più indirizzi insieme non aprono più finestre del tetto', async () => {
  const el = electronFinto();
  const quanti = sandbox.LIMITS.MAX_CONCURRENT + sandbox.LIMITS.MAX_QUEUE + 3;
  const corse = [];
  for (let i = 0; i < quanti; i++) {
    // Sottodomini sempre nuovi: è così che si aggirava la cache per host.
    corse.push(sandbox.detonate(`http://s${i}.esempio.test/`, () => new Promise(() => {}), {
      electron: el, timeoutMs: 5000, hardLifetimeMs: 30,
    }));
  }
  await attendi(10);
  assert.ok(el.state.aperte <= sandbox.LIMITS.MAX_CONCURRENT,
    `finestre aperte insieme: ${el.state.aperte}, tetto ${sandbox.LIMITS.MAX_CONCURRENT}`);

  const esiti = await Promise.all(corse);
  assert.equal(esiti.filter((e) => e !== null).length, 0, 'nessuna di queste arriva a un verdetto');
  assert.ok(el.state.picco <= sandbox.LIMITS.MAX_CONCURRENT,
    `picco di finestre ${el.state.picco}, tetto ${sandbox.LIMITS.MAX_CONCURRENT}`);
  // Chi ha trovato la coda piena non ha nemmeno aperto una finestra.
  assert.ok(el.state.create <= sandbox.LIMITS.MAX_CONCURRENT + sandbox.LIMITS.MAX_QUEUE,
    `finestre create in tutto: ${el.state.create}`);
  assert.equal(el.state.aperte, 0, 'alla fine non ne resta nessuna viva');
  assert.deepEqual(sandbox.stats(), { active: 0, queued: 0 }, 'il tetto torna libero');
});

// ─── La memoria: per dominio registrabile, non per host ─────────────────────

test('il verdetto profondo si ricorda per dominio, non per sottodominio', async () => {
  const chiamati = [];
  safebrowse._caches.sandboxCache.m.clear();
  safebrowse._caches.llmCache.m.clear();
  safebrowse.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async (meta) => { chiamati.push('llm:' + meta.host); return { verdict: 'unclear' }; },
    sandbox: async (url) => { chiamati.push('sandbox:' + url); return { verdict: 'clean' }; },
  });

  // Un indirizzo che il motore locale trova sospetto: senza sospetto gli stadi
  // profondi non partono affatto.
  const sospetto = (host) => `http://paypal-secure-login.${host}/verifica`;
  const attese = [];
  safebrowse.analyze(sospetto('truffa-esempio.com'), {}, () => {});
  await attendi(5);
  const dopoIlPrimo = chiamati.length;
  assert.ok(dopoIlPrimo > 0, 'il primo passaggio deve far partire gli stadi profondi');

  // Sottodomini nuovi sullo STESSO dominio registrabile: prima ripartivano
  // tutti, perché la memoria era sull'host completo.
  for (let i = 0; i < 20; i++) {
    attese.push(safebrowse.analyze(`http://n${i}.paypal-secure-login.truffa-esempio.com/verifica`, {}, () => {}));
  }
  await attendi(10);
  assert.equal(chiamati.length, dopoIlPrimo,
    'sottodomini nuovi sullo stesso dominio non devono far ripartire niente');

  // Un dominio registrabile DIVERSO invece è un caso nuovo, e si controlla.
  safebrowse.analyze(sospetto('altra-truffa.com'), {}, () => {});
  await attendi(5);
  assert.ok(chiamati.length > dopoIlPrimo, 'un dominio diverso resta un controllo nuovo');

  safebrowse.setProviders({ gsb: null, rdap: null, ct: null, llm: null, sandbox: null });
});
