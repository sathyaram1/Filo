// #753 — ogni sessione che Filo crea passa dal punto di nascita (src/main/services/sessioni.js)
// e riceve le protezioni registrate lì: GPC, tracker, pubblicità, gestore dei permessi.
// Nessuno deve ricordarsi di chiamare qualcosa quando crea una sessione nuova.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { creaNascita } = require(join(ROOT, 'src', 'main', 'services', 'sessioni.js'));

// Finto Electron: fromPartition emette session-created in modo sincrono e tiene
// in cache la sessione per nome, come quello vero.
function finto({ pronta = true } = {}) {
  const app = new EventEmitter();
  let risolvi;
  const ready = new Promise((r) => { risolvi = r; });
  app.isReady = () => pronta;
  app.whenReady = () => (pronta ? Promise.resolve() : ready);
  const cache = new Map();
  const nuova = (nome) => ({ nome });
  const defaultSession = nuova('default');
  const fromPartition = (nome) => {
    if (cache.has(nome)) return cache.get(nome);
    const s = nuova(nome);
    cache.set(nome, s);
    app.emit('session-created', s);
    return s;
  };
  const diventaPronta = () => { pronta = true; risolvi(); };
  return { app, defaultSession, fromPartition, diventaPronta };
}

test('ogni partizione creata riceve tutte le protezioni, una volta sola', () => {
  const e = finto();
  const n = creaNascita({ app: e.app, sessioneDefault: () => e.defaultSession });
  const visti = [];
  n.allaNascita('cookie', (s) => visti.push(`cookie:${s.nome}`));
  n.allaNascita('permessi', (s) => visti.push(`permessi:${s.nome}`));
  const incognito = e.fromPartition('filo-incognito-1');
  e.fromPartition('proxy:7');
  e.fromPartition('filo-priv-example.com');
  e.fromPartition('filo-incognito-1'); // stessa partizione: niente seconda nascita
  e.app.emit('session-created', incognito); // né un secondo evento
  assert.deepEqual(visti.sort(), [
    'cookie:default', 'cookie:filo-incognito-1', 'cookie:filo-priv-example.com', 'cookie:proxy:7',
    'permessi:default', 'permessi:filo-incognito-1', 'permessi:filo-priv-example.com', 'permessi:proxy:7',
  ].sort());
  assert.equal(n.nate().length, 4);
});

test('una protezione registrata dopo arriva anche alle sessioni già nate', () => {
  const e = finto();
  const n = creaNascita({ app: e.app, sessioneDefault: () => e.defaultSession });
  n.installa();
  e.fromPartition('filo-incognito-2');
  const visti = [];
  n.allaNascita('tardiva', (s) => visti.push(s.nome));
  e.fromPartition('proxy:9');
  assert.deepEqual(visti, ['default', 'filo-incognito-2', 'proxy:9']);
});

test('la sessione di default passa dal punto di nascita anche se l\'app non è ancora pronta', async () => {
  const e = finto({ pronta: false });
  const n = creaNascita({ app: e.app, sessioneDefault: () => e.defaultSession });
  const visti = [];
  n.allaNascita('cookie', (s) => visti.push(s.nome));
  assert.deepEqual(visti, []);
  e.diventaPronta();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(visti, ['default']);
});

test('una protezione che fallisce non lascia scoperte le altre', () => {
  const e = finto();
  const n = creaNascita({ app: e.app, sessioneDefault: () => e.defaultSession });
  const visti = [];
  const errore = console.error;
  console.error = () => {};
  try {
    n.allaNascita('rotta', () => { throw new Error('boom'); });
    n.allaNascita('cookie', (s) => visti.push(s.nome));
    e.fromPartition('proxy:1');
  } finally { console.error = errore; }
  assert.deepEqual(visti, ['default', 'proxy:1']);
});

test('una sessione di servizio nasce protetta, e il marchio è già lì quando le protezioni la leggono', () => {
  const e = finto();
  const n = creaNascita({ app: e.app, sessioneDefault: () => e.defaultSession });
  const visti = [];
  n.allaNascita('cookie', (s) => visti.push(`${s.nome}:${n.eDiServizio(s) ? 'servizio' : 'utente'}`));
  const detonazione = n.diServizio(() => e.fromPartition('filo-detonate-1'));
  e.fromPartition('proxy:2');
  assert.equal(detonazione.nome, 'filo-detonate-1');
  assert.deepEqual(visti, ['default:utente', 'filo-detonate-1:servizio', 'proxy:2:utente']);
  assert.equal(n.eNata(detonazione), true);
  // Una sessione già nata per l'utente non diventa di servizio perché qualcuno la richiede lì dentro.
  const proxy = n.diServizio(() => e.fromPartition('proxy:2'));
  assert.equal(n.eDiServizio(proxy), false);
});

// ─── sentinelle sul codice ───────────────────────────────────────────────

function sorgenti(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...sorgenti(p));
    else if (nome.endsWith('.js')) out.push(p);
  }
  return out;
}
const MAIN = sorgenti(join(ROOT, 'src', 'main')).map((p) => ({
  rel: relative(ROOT, p).split('\\').join('/'),
  testo: readFileSync(p, 'utf8'),
}));

test('GPC e blocchi si accendono solo dal punto di nascita, non da chi crea la sessione', () => {
  const fuori = MAIN.filter((f) => f.rel !== 'src/main/services/cookies.js'
    && /\b(applyGpc|applyTrackerBlocking|ensureHeaderHook)\s*\(/.test(f.testo));
  assert.deepEqual(fuori.map((f) => f.rel), [],
    'accendere la protezione a mano su una sessione vuol dire che le altre possono nascere senza: registrala con Sessioni.allaNascita');
  const cookies = MAIN.find((f) => f.rel === 'src/main/services/cookies.js').testo;
  assert.match(cookies, /Sessioni\.allaNascita\(\s*'cookie'/, 'cookies.js non registra più GPC e blocchi al punto di nascita');
  assert.match(cookies, /for \(const ses of Sessioni\.nate\(\)\)/, 'il cambio di modalità deve riallineare ogni sessione nata, non solo la default');
});

test('ogni gestore dei permessi si installa dal punto di nascita', () => {
  for (const f of MAIN) {
    if (!/\.setPermission(Request|Check)Handler\s*\(/.test(f.testo)) continue;
    assert.match(f.testo, /Sessioni\.allaNascita\(/,
      `${f.rel} installa un gestore dei permessi senza passare dal punto di nascita: una sessione nuova resterebbe senza`);
  }
});

test('solo le sessioni di servizio in elenco nascono senza protezione', () => {
  const ESENTI = ['src/main/services/safebrowse/sandbox.js'];
  const usano = MAIN.filter((f) => f.rel !== 'src/main/services/sessioni.js' && /senzaProtezione\s*\(/.test(f.testo)).map((f) => f.rel);
  assert.deepEqual(usano.sort(), ESENTI.sort(),
    'una sessione nuova senza protezione è una scelta: va motivata e aggiunta a questo elenco');
});

test('il punto di nascita è installato prima di ogni altra cosa, e GPC non torna al dom-ready', () => {
  const main = MAIN.find((f) => f.rel === 'src/main/main.js').testo;
  const installa = main.indexOf("require('./services/sessioni').installa()");
  assert.ok(installa > 0, 'main.js non installa il punto di nascita');
  assert.ok(installa < main.indexOf('whenReady'), 'il punto di nascita va installato prima di whenReady');
  const tabs = MAIN.find((f) => f.rel === 'src/main/tabs.js').testo;
  assert.doesNotMatch(tabs, /globalPrivacyControl/, 'GPC al dom-ready arriva tardi e solo nel frame principale: sta nel preambolo del preload');
  const preload = readFileSync(join(ROOT, 'src', 'preload', 'page-preload.js'), 'utf8');
  assert.match(preload, /buildGpcSource\(\)/, 'il preload non inietta più il preambolo GPC');
});
