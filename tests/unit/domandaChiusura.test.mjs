// Unit test della domanda di fine sessione: il client del canale (routine-channel.mjs
// domanda/risposta), lo strumento dell'owner (routine-domanda.mjs) e i testi di ruolo.
// Il server può non avere ancora l'endpoint: allora si chiude comunque (exit 2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(QUI, '..', '..');
const CANALE = resolve(ROOT, 'scripts', 'routine-channel.mjs');
const canale = await import('../../scripts/routine-channel.mjs');
const owner = await import('../../scripts/routine-domanda.mjs');
const { absolutizeRecipe } = await import('../../scripts/lib/tools-pin.mjs');
const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');

const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const piano = { sleep: async () => {} };

// ─── corpi delle richieste ──────────────────────────────────────────────────

test('corpo: una credenziale sola, e l\'id viaggia solo con la parola d\'ordine', () => {
  assert.deepEqual(canale.corpoChiusura('question', { passphrase: 'p' }), { passphrase: 'p', op: 'question' });
  assert.deepEqual(canale.corpoChiusura('question', { ticket: 't' }), { ticket: 't', op: 'question' });
  assert.deepEqual(canale.corpoChiusura('answer', { passphrase: 'p', id: 'c1', answer: 'niente' }),
    { passphrase: 'p', op: 'answer', id: 'c1', answer: 'niente' });
  assert.deepEqual(canale.corpoChiusura('answer', { ticket: 't', id: 'ignorato', answer: 'x' }),
    { ticket: 't', op: 'answer', answer: 'x' });
  assert.throws(() => canale.corpoChiusura('question', { passphrase: 'p', ticket: 't' }));
  assert.throws(() => canale.corpoChiusura('question', {}));
});

// ─── lettura delle risposte ed exit ─────────────────────────────────────────

test('endpoint che non esiste (404 senza motivo del server), rete giù, 5xx → nessuna domanda, exit 2', () => {
  for (const [s, b] of [[404, { ok: false, reason: 'malformed_response' }], [404, {}], [0, { ok: false, reason: 'network' }], [503, { ok: false }]]) {
    const r = canale.leggiRispostaChiusura(s, b);
    assert.equal(r.esito, 'assente', `${s} ${JSON.stringify(b)}`);
    assert.equal(canale.EXIT_CHIUSURA[r.esito], 2);
  }
});

test('un no del server è un rifiuto (exit 4), anche quando è un 404 col suo motivo', () => {
  for (const [s, reason] of [[404, 'bad_closing'], [409, 'already_answered'], [400, 'answer_missing'], [401, 'bad_passphrase'], [400, 'bad_request']]) {
    const r = canale.leggiRispostaChiusura(s, { ok: false, reason });
    assert.equal(r.esito, 'rifiutato', reason);
    assert.equal(r.reason, reason);
    assert.equal(canale.EXIT_CHIUSURA[r.esito], 4);
  }
});

test('answer_too_big: il rifiuto porta byte e massimo, e la riga stampata li dice', () => {
  const r = canale.leggiRispostaChiusura(413, { ok: false, reason: 'answer_too_big', bytes: 40123, max: 32768 });
  assert.equal(r.esito, 'rifiutato');
  const riga = canale.testoRifiutoChiusura(r);
  assert.match(riga, /answer_too_big/);
  assert.match(riga, /40123/);
  assert.match(riga, /32768/);
});

test('domanda: va a routineClosing col corpo giusto e torna testo e id', async () => {
  let url = ''; let corpo = null;
  const fetchImpl = async (u, init) => { url = u; corpo = JSON.parse(init.body); return reply(200, { ok: true, id: 'c9', question: 'Cosa non ha funzionato?' }); };
  const r = await canale.domandaChiusura({ passphrase: 'p' }, { fetchImpl, ...piano });
  assert.match(url, /\/routineClosing$/);
  assert.deepEqual(corpo, { passphrase: 'p', op: 'question' });
  assert.deepEqual(r, { esito: 'ok', question: 'Cosa non ha funzionato?', id: 'c9' });
});

test('domanda: un ok senza testo, o senza l\'id per rispondere, non è una domanda', async () => {
  const senzaId = await canale.domandaChiusura({ passphrase: 'p' }, { fetchImpl: async () => reply(200, { ok: true, question: 'D?' }), ...piano });
  assert.equal(senzaId.esito, 'assente');
  const vuota = await canale.domandaChiusura({ ticket: 't' }, { fetchImpl: async () => reply(200, { ok: true, question: '  ' }), ...piano });
  assert.equal(vuota.esito, 'assente');
  const worker = await canale.domandaChiusura({ ticket: 't' }, { fetchImpl: async () => reply(200, { ok: true, question: 'D?' }), ...piano });
  assert.equal(worker.esito, 'ok', 'col biglietto l\'id non serve');
});

test('risposta: il testo parte intero, anche lungo (il tetto lo tiene il server, col rifiuto)', async () => {
  const lungo = 'à'.repeat(40000);
  let corpo = null;
  const fetchImpl = async (u, init) => { corpo = JSON.parse(init.body); return reply(200, { ok: true }); };
  const r = await canale.rispostaChiusura({ ticket: 't' }, lungo, { fetchImpl, ...piano });
  assert.equal(r.esito, 'ok');
  assert.equal(corpo.answer, lungo);
});

// ─── parsing dei sottocomandi ───────────────────────────────────────────────

test('argomenti: parola d\'ordine per l\'orchestratore, --biglietto per il worker, mai tutti e due', () => {
  const a = canale.argomentiChiusura;
  assert.deepEqual(a('domanda', ['p'], {}), { cred: { passphrase: 'p' } });
  assert.deepEqual(a('risposta', ['p', 'c1'], {}), { cred: { passphrase: 'p', id: 'c1' } });
  assert.deepEqual(a('domanda', [], { biglietto: 't' }), { cred: { ticket: 't' } });
  assert.deepEqual(a('risposta', [], { biglietto: 't' }), { cred: { ticket: 't' } });
  assert.ok(a('domanda', [], {}).errore, 'nessuna credenziale');
  assert.ok(a('risposta', ['p'], {}).errore, 'manca l\'id');
  assert.ok(a('domanda', ['p', 'avanzo'], {}).errore, 'una parola in più non si ignora');
  assert.ok(a('domanda', ['p'], { biglietto: 't' }).errore, 'due credenziali');
  assert.ok(a('risposta', [], { biglietto: 't', role: 'resolver' }).errore, 'un campo che qui non vale');
});

test('il comando stampato per rispondere: heredoc, id vero, parola d\'ordine MAI in chiaro', () => {
  const orch = canale.comandoRisposta('/s/routine-channel.mjs', { passphrase: 'segreto-vero' }, 'c1');
  assert.ok(!orch.includes('segreto-vero'));
  assert.match(orch, /^node "\/s\/routine-channel\.mjs" risposta "<parola-d-ordine>" c1 <<'FINE'\n.*\nFINE$/);
  const w = canale.comandoRisposta('/s/routine-channel.mjs', { ticket: 'tk' });
  assert.match(w, /risposta --biglietto tk <<'FINE'/);
});

// ─── il CLI vero contro un server finto ─────────────────────────────────────

function fintoServer(status, risposta) {
  const richieste = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      richieste.push({ url: req.url, body: body ? JSON.parse(body) : {} });
      res.statusCode = status;
      res.end(typeof risposta === 'string' ? risposta : JSON.stringify(risposta));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, richieste, port: srv.address().port })));
}

// spawn ASINCRONO: il server finto vive in questo processo.
function cli(port, args, stdin = '') {
  const env = { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${port}` };
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [CANALE, ...args], { env });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (c) => { stdout += c; });
    p.stderr.on('data', (c) => { stderr += c; });
    p.on('close', (status) => risolvi({ status, stdout, stderr }));
    p.stdin.end(stdin);
  });
}

test('CLI: server senza l\'endpoint (404 con una pagina) → exit 2 su domanda e su risposta', async () => {
  const { srv, port } = await fintoServer(404, '<html>Page not found</html>');
  try {
    const d = await cli(port, ['domanda', 'p']);
    assert.equal(d.status, 2, d.stderr);
    const r = await cli(port, ['risposta', '--biglietto', 'tk'], 'niente\n');
    assert.equal(r.status, 2, r.stderr);
  } finally { srv.close(); }
});

test('CLI: domanda → exit 0, stampa la domanda e il comando esatto per rispondere', async () => {
  const { srv, richieste, port } = await fintoServer(200, { ok: true, id: 'c42', question: 'Cosa ti ha rallentato?' });
  try {
    const r = await cli(port, ['domanda', 'parola-segreta']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Cosa ti ha rallentato\?/);
    assert.match(r.stdout, /routine-channel\.mjs" risposta "<parola-d-ordine>" c42 <<'FINE'/);
    assert.ok(!r.stdout.includes('parola-segreta'));
    assert.deepEqual(richieste[0].body, { passphrase: 'parola-segreta', op: 'question' });
  } finally { srv.close(); }
});

test('CLI: risposta da stdin col biglietto → arriva intera, apostrofi compresi', async () => {
  const { srv, richieste, port } = await fintoServer(200, { ok: true });
  try {
    const r = await cli(port, ['risposta', '--biglietto', 'tk'], "L'ultimo passo m'ha confuso.\n");
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(richieste[0].body, { ticket: 'tk', op: 'answer', answer: "L'ultimo passo m'ha confuso." });
  } finally { srv.close(); }
});

test('CLI: answer_too_big → exit 4 coi numeri stampati', async () => {
  const { srv, port } = await fintoServer(413, { ok: false, reason: 'answer_too_big', bytes: 50001, max: 32768 });
  try {
    const r = await cli(port, ['risposta', 'p', 'c1'], 'x'.repeat(100));
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /50001/);
    assert.match(r.stderr, /32768/);
  } finally { srv.close(); }
});

test('CLI: risposta vuota → non manda niente', async () => {
  const { srv, richieste, port } = await fintoServer(200, { ok: true });
  try {
    const r = await cli(port, ['risposta', '--biglietto', 'tk'], '  \n');
    assert.equal(r.status, 1);
    assert.equal(richieste.length, 0);
  } finally { srv.close(); }
});

// ─── lo strumento dell'owner ────────────────────────────────────────────────

test('owner: sottocomandi e --n', () => {
  const l = owner.leggiArgomenti;
  assert.deepEqual(l([]), { cmd: 'mostra' });
  assert.deepEqual(l(['imposta', 'worker', 'Cosa', 'manca?']), { cmd: 'imposta', slot: 'worker', testo: 'Cosa manca?' });
  assert.deepEqual(l(['imposta', 'resolver']), { cmd: 'imposta', slot: 'resolver', testo: '' });
  assert.deepEqual(l(['togli', 'orchestrator']), { cmd: 'togli', slot: 'orchestrator' });
  assert.deepEqual(l(['risposte']), { cmd: 'risposte' });
  assert.deepEqual(l(['risposte', '--n', '7']), { cmd: 'risposte', n: 7 });
  assert.deepEqual(l(['risposte', '--n=3']), { cmd: 'risposte', n: 3 });
  assert.ok(l(['risposte', '--n', 'zero']).errore);
  assert.ok(l(['risposte', '--dry-run']).errore);
  assert.ok(l(['togli']).errore);
  assert.ok(l(['inventato']).errore);
});

test('owner: risposte in un elenco solo dal più recente, con ruolo, #numero, durata e testi interi', () => {
  const lunga = 'r'.repeat(5000);
  const out = owner.formattaRisposte({
    orchestrator: [
      { id: 'a', slug: 'cloud-a', askedAtMs: 3000, question: 'D orch?', answered: true, answer: 'niente' },
      { id: 'b', slug: 'cloud-a', askedAtMs: 1000, question: 'D vecchia?', answered: false },
    ],
    workers: [
      { slug: 'cloud-b', role: 'resolver', num: '712', createdAtMs: 0, releasedAtMs: 38 * 60000, closing: { question: 'D w?', askedAtMs: 2000, answer: lunga } },
      { slug: 'cloud-b', role: 'verifier', num: '9', createdAtMs: 0, closing: null },
    ],
  }, { n: 10, quando: (ms) => `t${ms}` });
  const blocchi = out.split('\n\n');
  assert.equal(blocchi.length, 3, 'il worker senza domanda non compare');
  assert.match(blocchi[0], /^t3000 {2}orchestratore · cloud-a/);
  assert.match(blocchi[1], /^t2000 {2}resolver #712 · 38 min · cloud-b/);
  assert.ok(blocchi[1].includes(lunga), 'la risposta non si taglia');
  assert.match(blocchi[2], /R: \(nessuna risposta\)/);
});

test('owner: oltre --n si dice quante ne restano fuori', () => {
  const orchestrator = [1, 2, 3].map((i) => ({ slug: 's', askedAtMs: i, question: 'D', answered: true, answer: 'x' }));
  const out = owner.formattaRisposte({ orchestrator, workers: [] }, { n: 2, quando: (ms) => `t${ms}` });
  assert.equal((out.match(/^t\d/gm) || []).length, 2);
  assert.match(out, /altre 1 più vecchie/);
});

test('owner: mostra gli slot e il ripiego', () => {
  const out = owner.formattaDomande({ slots: { worker: { text: 'Dw', setAtMs: 1 } }, default: 'Il ripiego' });
  assert.match(out, /worker\n {2}Dw/);
  assert.match(out, /Il ripiego/);
});

// ─── testi di ruolo ─────────────────────────────────────────────────────────

test('i testi di ruolo chiedono la domanda, e il comando viene riscritto col percorso degli strumenti', () => {
  const base = resolve('/strumenti').split('\\').join('/');
  const orch = absolutizeRecipe(readFileSync(resolve(ROOT, 'routines', 'roles', 'orchestrator.md'), 'utf8'), '/strumenti', '/progetto');
  assert.ok(orch.includes(`node "${base}/scripts/routine-channel.mjs" domanda`), 'orchestratore: domanda');
  assert.ok(orch.includes(`node "${base}/scripts/routine-channel.mjs" risposta "<parola-d-ordine>" <id> <<'FINE'`), 'orchestratore: risposta');
  const worker = absolutizeRecipe(readRoleInstructions('new-work'), '/strumenti', '/progetto');
  assert.ok(worker.includes(`node "${base}/scripts/routine-channel.mjs" domanda --biglietto <biglietto>`), 'worker: domanda');
  // Prima del rilascio: col biglietto già morto la domanda non si può più chiedere.
  assert.ok(worker.indexOf('domanda --biglietto') < worker.indexOf('release <biglietto> --role'), 'worker: la domanda viene prima del rilascio');
});
