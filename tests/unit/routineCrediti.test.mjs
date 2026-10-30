// I numeri dell'owner sui crediti delle routine (src/shared/routineCrediti.js) e la porta del main verso ownerCrediti
// (handlers/auth.js, #1356): stessi rifiuti in pagina e nel main, si scrive solo il campo toccato, un numero che il
// server non ha dato resta un trattino. Harness di domandeHandler.test.mjs: handler vero, server HTTP locale.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'routineCrediti.js'));
const RC = globalThis.SN_ROUTINE_CREDITI;

test('valida: solo i campi ricevuti; vuoto o null toglie il numero; fuori misura si rifiuta col suo intervallo', () => {
  assert.deepEqual(RC.valida({ riservaA: '10' }), { ok: true, valori: { riservaA: 10 } });
  assert.deepEqual(RC.valida({ tettoB: '82,5' }), { ok: true, valori: { tettoB: 82.5 } }, 'la virgola è un decimale');
  assert.deepEqual(RC.valida({ usdPer100: '' }), { ok: true, valori: { usdPer100: null } });
  assert.deepEqual(RC.valida({ rinnovoA: null }), { ok: true, valori: { rinnovoA: null } });
  assert.deepEqual(RC.valida({ riservaA: '  ' }), { ok: true, valori: { riservaA: null } });
  const r = RC.valida({ riservaA: '140' });
  assert.equal(r.ok, false);
  assert.match(r.testo, /Riserva di A: da 0 a 100\. Non salvato\./);
  assert.match(RC.valida({ tettoB: 'tanto' }).testo, /Tetto di B: ci vuole un numero/);
  assert.match(RC.valida({ usdPer100: '0' }).testo, /Taratura: da 0,01/);
  assert.match(RC.valida({ rinnovoB: 'domani' }).testo, /Rinnovo di B: ci vuole un giorno e un'ora/);
  assert.match(RC.valida({ rinnovoB: 1760000 }).testo, /fra il 2020 e il 2100/, 'secondi al posto dei millisecondi');
  assert.equal(RC.valida({}).ok, false);
  assert.equal(RC.valida({ altro: 3 }).ok, false);
  assert.deepEqual(Object.keys(RC.valida({ riservaA: 5, nonMio: 1 }).valori), ['riservaA']);
});

test('rinnovo: il campo data nell ora di questo computer va e torna in millisecondi', () => {
  const ms = RC.daOraLocale('2026-10-16T12:00');
  assert.equal(ms, new Date(2026, 9, 16, 12, 0).getTime());
  assert.equal(RC.aOraLocale(ms), '2026-10-16T12:00');
  assert.deepEqual(RC.valida({ rinnovoB: '2026-10-16T12:00' }), { ok: true, valori: { rinnovoB: ms } });
  assert.equal(RC.daOraLocale(''), null);
  assert.equal(RC.daOraLocale('16/10/2026'), null);
  assert.equal(RC.aOraLocale(null), '');
});

test('leggiNumeri: un numero assente è null, non zero', () => {
  assert.deepEqual(RC.leggiNumeri({ riservaA: 10, usdPer100: 2150 }), { riservaA: 10, tettoB: null, usdPer100: 2150, rinnovoA: null, rinnovoB: null });
  assert.deepEqual(RC.leggiNumeri(null), { riservaA: null, tettoB: null, usdPer100: null, rinnovoA: null, rinnovoB: null });
});

test('rigaAccount: percentuale, limite, passo di oggi, rinnovo, e perché è fermo; un numero mancante è un trattino', () => {
  const rinnovo = new Date(2026, 9, 13, 19, 0).getTime();
  const riga = RC.rigaAccount('A', { pct: 46.5, limite: 90, passo: { spesoPct: 3, quotaPct: 12.4, giornoDaMs: rinnovo - 24 * 3600e3 }, rinnovoAtMs: rinnovo, fermo: '' });
  assert.match(riga, /^46,5% della settimana, limite 90% · resta 43,5% · oggi 3% su 12,4% · rinnova /);
  assert.doesNotMatch(riga, /fermo|\$|accensioni/, 'senza dollari né accensioni dal server non se ne inventano');
  assert.match(RC.rigaAccount('A', { pct: 91, limite: 90, fermo: 'riserva' }), /fermo: riserva raggiunta/);
  assert.match(RC.rigaAccount('B', { pct: 81, limite: 80, fermo: 'riserva' }), /fermo: tetto raggiunto/);
  assert.match(RC.rigaAccount('B', { pct: 20, passo: { spesoPct: 21, quotaPct: 20, giornoDaMs: rinnovo }, fermo: 'passo' }), /fermo fino a /);
  assert.match(RC.rigaAccount('B', { pct: 20, basseAperte: true }), /ultime 24 ore: priorità basse aperte/);
  const vuota = RC.rigaAccount('B', {});
  assert.match(vuota, /^–% della settimana|^– della settimana/);
  assert.doesNotMatch(vuota, /0%|resta|\$/);
});

// #1787: il manutentore e la scheda Crediti leggono la spesa anche in dollari, con quanto resta e le accensioni.
test('rigaAccount: dollari della settimana e di quanto resta, ultime 24 ore e accensioni quando il server li dà', () => {
  const riga = RC.rigaAccount('A', { pct: 40, limite: 90, usdSettimana: 860, usd24h: 123.4, accensioniSettimana: 14, accensioni24h: 3 });
  assert.match(riga, /^40% della settimana \(≈ 860 \$\), limite 90% · resta 50% \(≈ 1\.075 \$\) · ultime 24 ore ≈ 123 \$ · accensioni: 14 in settimana, 3 nelle ultime 24 ore · rinnova /);
  // Settimana appena rinnovata: niente spesa da cui tarare, vale la taratura dell'owner.
  assert.match(RC.rigaAccount('B', { pct: 0, usdSettimana: 0 }, { usdPer100: 2000 }), /^0% della settimana \(≈ 0 \$\) · resta 100% \(≈ 2\.000 \$\)/);
  assert.match(RC.rigaAccount('B', { pct: 10 }, { usdPer100: 2150 }), /^10% della settimana \(≈ 215 \$\) · resta 90% \(≈ 1\.935 \$\)/);
  // Oltre il limite non resta un numero negativo; un conteggio storto non compare.
  assert.match(RC.rigaAccount('B', { pct: 85, limite: 80, usdSettimana: 1700, accensioni24h: -2, accensioniSettimana: 'x' }), /resta 0% \(≈ 0 \$\)/);
  assert.doesNotMatch(RC.rigaAccount('B', { pct: 85, accensioni24h: -2, accensioniSettimana: 'x' }), /accensioni/);
  assert.match(RC.rigaAccount('A', { pct: 5, accensioni24h: 0 }), /accensioni: 0 nelle ultime 24 ore/);
});

// ── La porta del main ────────────────────────────────────────────────────────

let server;
let rispondi = () => ({ status: 200, body: { result: { ok: true } } });
let ricevute = [];
let handlers;
let MSG;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      ricevute.push({ path: req.url, data });
      const r = rispondi(data);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FILO_FUNCTIONS_BASE = `http://127.0.0.1:${server.address().port}`;
  const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      isSignedIn: () => true, isAdmin: () => true, getIdToken: async () => 'token-di-prova',
      getProfile: () => ({ email: 'owner@esempio' }), getUid: async () => 'uid-owner', getAccessToken: async () => '',
      onChange: () => () => {},
    },
  };
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  MSG = globalThis.SN_MSG.MSG;
  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), { MSG, broadcastToTabs() {}, broadcastToFiloPages() {}, broadcastLiveUpdate() {} });
});

after(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  await new Promise((r) => server.close(r));
});

function chiama(msg) {
  const h = handlers.get(msg.type);
  assert.ok(h, `il main non registra ${msg.type}`);
  ricevute = [];
  return h(msg, { isShell: true }, 'filo://manage/manage.html');
}

const STATO = {
  ok: true, riserva: 'attivi', numeri: { riservaA: 10, usdPer100: 2150 },
  accounts: { A: { pct: 46.5, limite: 90, passo: { spesoPct: 3, quotaPct: 12 }, fermo: '', rinnovoAtMs: 1, usdSettimana: 1000, usd24h: 80, accensioniSettimana: 9, accensioni24h: 2 }, B: { pct: 10, limite: null } },
  sessioni: [{ sessionId: 's1', costUsd: 3 }],
};

test('lettura: op stato, alla pagina numeri, account e freni; le sessioni restano sul server', async () => {
  rispondi = () => ({ status: 200, body: { result: STATO } });
  const r = await chiama({ type: MSG.ROUTINE_CREDITI_GET });
  assert.equal(ricevute[0].path, '/ownerCrediti');
  assert.deepEqual(ricevute[0].data, { op: 'stato' });
  assert.deepEqual(r.numeri, { riservaA: 10, tettoB: null, usdPer100: 2150, rinnovoA: null, rinnovoB: null });
  assert.equal(r.accounts.A.passo.quotaPct, 12);
  assert.equal(r.freni, 'attivi');
  assert.equal(r.sessioni, undefined);
});

test('scrittura: al server va il solo campo toccato, già controllato; null toglie; un valore storto non parte', async () => {
  rispondi = (d) => ({ status: 200, body: { result: d.op === 'imposta' ? { ok: true, numeri: { riservaA: 12, usdPer100: 2150 } } : STATO } });
  const r = await chiama({ type: MSG.ROUTINE_CREDITI_SET, riservaA: 12, op: 'lettura', pct7d: 99 });
  assert.equal(r.ok, true);
  assert.deepEqual(ricevute[0].data, { op: 'imposta', riservaA: 12 });
  assert.equal(r.numeri.riservaA, 12);
  assert.equal(r.accounts.A.pct, 46.5, 'lo stato riletto dopo la scrittura');
  await chiama({ type: MSG.ROUTINE_CREDITI_SET, rinnovoB: null });
  assert.deepEqual(ricevute[0].data, { op: 'imposta', rinnovoB: null });
  const storto = await chiama({ type: MSG.ROUTINE_CREDITI_SET, tettoB: 140 });
  assert.equal(storto.ok, false);
  assert.match(storto.error, /Tetto di B: da 0 a 100/);
  assert.equal(ricevute.length, 0, 'il server non si chiama');
});

test('errori: il rifiuto del server con la sua spiegazione; una funzione non pubblicata si dice', async () => {
  rispondi = () => ({ status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'riservaA=140: fra 0 e 100' } } });
  assert.deepEqual(await chiama({ type: MSG.ROUTINE_CREDITI_SET, riservaA: 10 }), { ok: false, error: 'riservaA=140: fra 0 e 100' });
  rispondi = () => ({ status: 404, body: {} });
  const r = await chiama({ type: MSG.ROUTINE_CREDITI_GET });
  assert.equal(r.ok, false);
  assert.match(r.error, /non sono ancora pubblicati/);
  // Scritto sì, riletto no: i numeri tornano dalla scrittura, lo stato per account no.
  rispondi = (d) => (d.op === 'imposta' ? { status: 200, body: { result: { ok: true, numeri: { tettoB: 80 } } } } : { status: 500, body: {} });
  const meta = await chiama({ type: MSG.ROUTINE_CREDITI_SET, tettoB: 80 });
  assert.equal(meta.ok, true);
  assert.equal(meta.numeri.tettoB, 80);
  assert.equal(meta.accounts, undefined);
});
