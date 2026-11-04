// Gli strumenti dell'owner che vivevano solo da terminale (#1926), dalla porta del main verso le callable del
// proprietario: parole d'ordine (anche di sessione), domanda di fine sessione, storico dei giri, ordine del
// manutentore, «segna fidati» in blocco, «annulla» di una risposta di sessione. Harness di manutentoreRecap.test.mjs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
      const r = rispondi(data, req.url);
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
  for (const f of ['constants.js', 'messages.js', 'feedback.js', 'routineChiavi.js', 'routineChiusura.js', 'manutentoreOrdine.js', 'storicoGiri.js']) {
    require(join(ROOT, 'src', 'shared', f));
  }
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

test('parola d’ordine di sessione: nasce da Gestione, si vede una volta, e dice dove va', async () => {
  rispondi = (d) => ({ status: 200, body: { result: { slug: d.slug, scope: d.scope, passphrase: 'parola-segreta-1' } } });
  const r = await chiama({ type: MSG.ROUTINE_CHIAVE_CREA, slug: ' pc-casa ', scope: 'sessione', label: 'Claude Code sul PC' });
  assert.deepEqual(ricevute.map((x) => [x.path, x.data]), [['/routineKeys', { op: 'issue', slug: 'pc-casa', scope: 'sessione', label: 'Claude Code sul PC' }]]);
  assert.deepEqual(r, { ok: true, slug: 'pc-casa', scope: 'sessione', passphrase: 'parola-segreta-1' });
  assert.match(globalThis.SN_ROUTINE_CHIAVI.DOVE_VA.sessione, /FILO_SESSIONE_PAROLA/);
  // Un potere che non esiste, un nome con gli spazi o vuoto: rifiutati prima del server.
  for (const storta of [{ slug: 'x', scope: 'admin' }, { slug: 'pc casa', scope: 'sessione' }, { slug: '  ', scope: 'routine' }]) {
    const n = await chiama(Object.assign({ type: MSG.ROUTINE_CHIAVE_CREA }, storta));
    assert.equal(n.ok, false);
    assert.equal(ricevute.length, 0, JSON.stringify(storta));
  }
  const lungo = await chiama({ type: MSG.ROUTINE_CHIAVE_CREA, slug: 'x'.repeat(65), scope: 'routine' });
  assert.match(lungo.error, /65 caratteri, il massimo è 64/);
  // Il server che non restituisce la parola non lascia credere che sia nata.
  rispondi = () => ({ status: 200, body: { result: { slug: 'a', scope: 'sessione' } } });
  assert.equal((await chiama({ type: MSG.ROUTINE_CHIAVE_CREA, slug: 'a', scope: 'sessione' })).ok, false);
  // Il motivo del rifiuto è del server.
  rispondi = () => ({ status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'Potere sconosciuto: sessione.' } } });
  assert.deepEqual(await chiama({ type: MSG.ROUTINE_CHIAVE_CREA, slug: 'a', scope: 'sessione' }), { ok: false, error: 'Potere sconosciuto: sessione.' });
});

test('elenco, revoca e impostazioni delle parole d’ordine passano dalla callable dell’owner', async () => {
  rispondi = () => ({ status: 200, body: { result: { keys: [
    { slug: 'vecchia', scope: 'routine', revoked: true },
    { slug: 'pc-casa', scope: 'sessione', lastUsedAt: '2026-11-01T10:00:00Z', label: '<b>x</b>' },
    { slug: 'cloud-a', scope: 'routine', account: 'A', rete: 'limitata' },
    { scope: 'routine' },
  ] } } });
  const r = await chiama({ type: MSG.ROUTINE_CHIAVI_ELENCO });
  assert.deepEqual(ricevute.map((x) => x.data), [{ op: 'list' }]);
  assert.deepEqual(r.keys.map((k) => [k.slug, k.revoked]), [['cloud-a', false], ['pc-casa', false], ['vecchia', true]]);
  assert.equal(r.keys[1].label, '<b>x</b>');

  rispondi = () => ({ status: 200, body: { result: { ok: true } } });
  assert.deepEqual(await chiama({ type: MSG.ROUTINE_CHIAVE_REVOCA, slug: 'pc-casa' }), { ok: true });
  assert.deepEqual(ricevute.map((x) => [x.path, x.data]), [['/routineKeys', { op: 'revoke', slug: 'pc-casa' }]]);
  assert.equal((await chiama({ type: MSG.ROUTINE_CHIAVE_REVOCA, slug: '' })).ok, false);
  assert.equal(ricevute.length, 0);

  assert.deepEqual(await chiama({ type: MSG.ROUTINE_CHIAVE_IMPOSTA, op: 'rete', slug: 'cloud-a', valore: 'aperta' }), { ok: true });
  assert.deepEqual(ricevute.map((x) => x.data), [{ op: 'rete', slug: 'cloud-a', rete: 'aperta' }]);
  for (const storta of [{ op: 'rete', valore: 'larga' }, { op: 'scope', valore: 'build' }]) {
    const n = await chiama(Object.assign({ type: MSG.ROUTINE_CHIAVE_IMPOSTA, slug: 'cloud-a' }, storta));
    assert.equal(n.ok, false);
    assert.equal(ricevute.length, 0, JSON.stringify(storta));
  }
  rispondi = () => ({ status: 404, body: {} });
  assert.match((await chiama({ type: MSG.ROUTINE_CHIAVI_ELENCO })).error, /non offre ancora questa funzione \(parole d’ordine\)/);
});

test('domanda di fine sessione: slot e risposte arrivano resi visibili, si imposta e si toglie', async () => {
  rispondi = (d) => ({ status: 200, body: { result: d.op === 'get'
    ? { slots: { worker: { text: 'Cosa ti è mancato?' }, tutti: { text: 'Niente?' } }, default: 'Ripiego.' }
    : { orchestrator: [{ slug: 'o1', askedAtMs: 1000, question: 'D1', answered: true, answer: 'R\u001b]0;x\u0007' }],
      workers: [{ role: 'fixer', num: '#12', slug: 'w', createdAtMs: 0, releasedAtMs: 120000, closing: { askedAtMs: 2000, question: 'D2', answer: 'niente' } }] } } });
  const r = await chiama({ type: MSG.ROUTINE_CHIUSURA_GET });
  assert.deepEqual(ricevute.map((x) => x.data).sort((a, b) => a.op.localeCompare(b.op)), [{ op: 'answers', limit: 50 }, { op: 'get' }]);
  assert.deepEqual(r.slots, [{ slot: 'tutti', testo: 'Niente?' }, { slot: 'worker', testo: 'Cosa ti è mancato?' }]);
  assert.equal(r.ripiego, 'Ripiego.');
  assert.deepEqual(r.risposte.map((v) => [v.chi, v.durata, v.risposta]), [['fixer #12 · w', '2 min', 'niente'], ['orchestratore · o1', '', 'R\\x1b]0;x\\x07']]);

  rispondi = () => ({ status: 200, body: { result: { ok: true } } });
  assert.deepEqual(await chiama({ type: MSG.ROUTINE_CHIUSURA_SET, slot: 'compito:riordino', testo: ' Ti è servito? ' }), { ok: true });
  assert.deepEqual(ricevute.map((x) => x.data), [{ op: 'set', slot: 'compito:riordino', text: 'Ti è servito?' }]);
  assert.deepEqual(await chiama({ type: MSG.ROUTINE_CHIUSURA_SET, slot: 'worker', testo: '   ' }), { ok: true });
  assert.deepEqual(ricevute.map((x) => x.data), [{ op: 'clear', slot: 'worker' }]);
  const n = await chiama({ type: MSG.ROUTINE_CHIUSURA_SET, slot: 'chiunque', testo: 'x' });
  assert.equal(n.ok, false);
  assert.equal(ricevute.length, 0);
});

test('storico dei giri: la finestra va al server, una finestra storta no', async () => {
  rispondi = () => ({ status: 200, body: { result: { lavori: [{ seq: 795, rounds: [{ found: [2], outcome: 'passa' }] }], troncato: true } } });
  const r = await chiama({ type: MSG.STORICO_GIRI_GET, da: 1000, a: 2000 });
  assert.deepEqual(ricevute.map((x) => [x.path, x.data]), [['/routineStateAdmin', { op: 'giri', da: 1000, a: 2000 }]]);
  assert.equal(r.troncato, true);
  assert.equal(globalThis.SN_STORICO_GIRI.totali(r.lavori).perLivello[2].trovati, 1);
  assert.equal((await chiama({ type: MSG.STORICO_GIRI_GET, da: 2000, a: 1000 })).ok, false);
  assert.equal(ricevute.length, 0);
  rispondi = () => ({ status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'Operazione sconosciuta.' } } });
  assert.match((await chiama({ type: MSG.STORICO_GIRI_GET, da: 1, a: 2 })).error, /non ha ancora lo storico/);
});

test('ordine del manutentore: i numeri puliti vanno al server, vuoto lo svuota, un numero storto no', async () => {
  rispondi = (d) => ({ status: 200, body: { result: { ok: true, ordine: d.ordine } } });
  assert.deepEqual(await chiama({ type: MSG.MANUTENTORE_ORDINE_SET, ordine: ['#812', '815.2', '812'] }), { ok: true, ordine: ['812', '815.2'] });
  assert.deepEqual(ricevute.map((x) => [x.path, x.data]), [['/ownerManutentore', { op: 'ordine', ordine: ['812', '815.2'] }]]);
  assert.deepEqual(await chiama({ type: MSG.MANUTENTORE_ORDINE_SET, ordine: [] }), { ok: true, ordine: [] });
  const n = await chiama({ type: MSG.MANUTENTORE_ORDINE_SET, ordine: ['812', 'ciao'] });
  assert.match(n.error, /non sono numeri di feedback: ciao/);
  assert.equal(ricevute.length, 0);
  rispondi = () => ({ status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'Operazione sconosciuta: ordine', details: { reason: 'operazione_sconosciuta' } } } });
  assert.match((await chiama({ type: MSG.MANUTENTORE_ORDINE_SET, ordine: ['812'] })).error, /non sa ancora prendere l’ordine da qui/);
});

test('«segna fidati» in blocco: uno per feedback, un esito per ognuno, un tetto che si dice', async () => {
  rispondi = (d) => (d.feedbackId === 'fb-2'
    ? { status: 400, body: { error: { status: 'FAILED_PRECONDITION', message: 'Segnalato come attacco.' } } }
    : { status: 200, body: { result: { ok: true, rimessoInCoda: d.feedbackId === 'fb-3' } } });
  const r = await chiama({ type: MSG.FIDUCIA_SEGNA_BLOCCO, feedbackIds: ['fb-1', 'fb-2', 'fb-3', 'fb-1', ''] });
  assert.equal(r.ok, true);
  assert.deepEqual(ricevute.map((x) => [x.path, x.data.op, x.data.feedbackId]).sort(), [
    ['/ownerFiducia', 'segna', 'fb-1'], ['/ownerFiducia', 'segna', 'fb-2'], ['/ownerFiducia', 'segna', 'fb-3']]);
  assert.deepEqual(r.esiti, [
    { feedbackId: 'fb-1', ok: true },
    { feedbackId: 'fb-2', ok: false, error: 'Segnalato come attacco.' },
    { feedbackId: 'fb-3', ok: true, rimessoInCoda: true },
  ]);
  const troppi = await chiama({ type: MSG.FIDUCIA_SEGNA_BLOCCO, feedbackIds: Array.from({ length: 2001 }, (_, i) => `fb-${i}`) });
  assert.match(troppi.error, /2001 feedback, il massimo in una volta è 2000/);
  assert.equal(ricevute.length, 0);
  // Il tasto sulla scheda passa dalla stessa strada.
  rispondi = () => ({ status: 200, body: { result: { ok: true } } });
  assert.deepEqual(await chiama({ type: MSG.FIDUCIA_SEGNA, feedbackId: 'fb-9' }), { ok: true, fiducia: 'fidato' });
  assert.deepEqual(ricevute.map((x) => x.data), [{ op: 'segna', feedbackId: 'fb-9' }]);
});

test('«annulla» una risposta di sessione chiede al server di disfarla; un server vecchio lo dice', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: true, domanda: { id: 'D-70', stato: 'aperta' } } } });
  assert.deepEqual(await chiama({ type: MSG.DOMANDA_ANNULLA, id: 'D-70' }), { ok: true, domanda: { id: 'D-70', stato: 'aperta' } });
  assert.deepEqual(ricevute.map((x) => [x.path, x.data]), [['/ownerDomande', { op: 'annulla', id: 'D-70' }]]);
  rispondi = () => ({ status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'op?', details: { reason: 'operazione_sconosciuta' } } } });
  assert.match((await chiama({ type: MSG.DOMANDA_ANNULLA, id: 'D-70' })).error, /non sa ancora annullare una risposta.*riaprirla/);
});
