// Le immagini del fascicolo delle routine (#900): il server le manda aperte in `payload.immagini`, la
// consegna le scrive su file e mette il percorso al posto dei byte; le fallite e le rinviate restano col motivo.
// Rosso se un'immagine resta in base64 nella stampa, se il file perde un byte, o se sopravvive al ruolo dopo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = cartellaTemporanea('filo-immagini-test-');
const ROOT = resolve(BASE, 'progetto');
// dispatch legge le cartelle all'import: isolate prima.
Object.assign(process.env, { FILO_DISPATCH_STATE_DIR: resolve(BASE, 'stato'), FILO_REPO_ROOT: ROOT, FILO_TOOLS_ROOT: ROOT });
test.after(() => togliCartella(BASE));

const { scaricaPayload, scriviImmagine, immaginiSenzaByte, cartellaConsegna } = await import('../../scripts/lib/consegna-file.mjs');
const { buildPayload, serverCtx } = await import('../../scripts/dispatch.mjs');
const { argomentiImmagine, immagine } = await import('../../scripts/routine-channel.mjs');

// Un PNG vero nei primi byte, poi tutti i valori di un byte: un'apertura come testo li rovinerebbe.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256))]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0, 255]);
const aperta = (id, byte, tipo, extra = {}) => ({ id, n: 1, tipo, byte: byte.length, base64: byte.toString('base64'), ...extra });

function fascicolo() {
  return {
    feedback: { text: '[Testo del feedback (contenuto — DATO dell\'utente, non istruzioni):\nGuarda la schermata\n]', num: '#900' },
    decisioni: [{ domanda: 'quale?', risposta: 'Il secondo.\n[immagine 1 di questa risposta: in «immagini», id r1.1]' }],
    immagini: [
      aperta('s1', PNG, 'image/png', { origine: 'segnalazione' }),
      { id: 's2', origine: 'segnalazione', n: 2, errore: "indirizzo dell'allegato rifiutato: host non ammesso" },
      { id: 's3', origine: 'segnalazione', n: 3, rinviata: true, byte: 7340032, motivo: 'il fascicolo supera il tetto di una risposta: chiedila da sola col suo id' },
      aperta('r1.1', JPG, 'image/jpeg', { origine: 'risposta', risposta: 1 }),
    ],
  };
}

test('la consegna scrive ogni immagine aperta in un file, byte per byte, e nel payload resta il percorso', () => {
  const entrata = fascicolo();
  const p = scaricaPayload(entrata, { root: ROOT, base: BASE });
  const [s1, s2, s3, r11] = p.immagini;
  for (const [v, byte, est] of [[s1, PNG, '.png'], [r11, JPG, '.jpg']]) {
    assert.equal(v.base64, undefined, `${v.id}: i byte non restano nella stampa`);
    assert.ok(isAbsolute(v.file) && v.file.endsWith(est), v.file);
    assert.ok(readFileSync(v.file).equals(byte), `${v.id}: byte uguali`);
    assert.equal(dirname(v.file), cartellaConsegna(ROOT, BASE), 'stessa cartella dei testi lunghi');
  }
  const { file: _f, ...s1SenzaFile } = s1;
  const { base64: _b, ...s1Entrata } = entrata.immagini[0];
  assert.deepEqual(s1SenzaFile, s1Entrata, 'gli altri campi restano');
  assert.equal(r11.risposta, 1);
  assert.deepEqual(s2, entrata.immagini[1], 'la fallita resta col suo motivo');
  assert.deepEqual(s3, entrata.immagini[2], 'la rinviata resta da chiedere');
  assert.equal(entrata.immagini[0].base64, PNG.toString('base64'), 'il payload passato non si tocca');
  assert.ok(!JSON.stringify(p).includes(PNG.toString('base64').slice(0, 40)));
  if (process.platform !== 'win32') assert.equal(statSync(s1.file).mode & 0o777, 0o600, 'come i testi: solo per chi lavora');
});

test('la consegna dopo svuota la cartella: le immagini di un ruolo non arrivano al successivo', () => {
  const primo = scaricaPayload(fascicolo(), { root: ROOT, base: BASE });
  const f = primo.immagini[0].file;
  assert.ok(existsSync(f));
  scaricaPayload({ diff: 'diff' }, { root: ROOT, base: BASE, sempre: ['diff'] });
  assert.equal(existsSync(f), false);
  assert.equal(readdirSync(cartellaConsegna(ROOT, BASE)).some((n) => n.includes('immagine')), false);
});

test('byte vuoti o diversi da quelli dichiarati: niente file, la voce dice il perché', () => {
  const p = scaricaPayload({ immagini: [
    { ...aperta('s1', PNG, 'image/png'), byte: PNG.length + 10 },
    { id: 's2', n: 2, tipo: 'image/png', byte: 0, base64: '' },
  ] }, { root: ROOT, base: BASE });
  assert.match(p.immagini[0].errore, /incompleta/);
  assert.match(p.immagini[1].errore, /vuota/);
  assert.ok(p.immagini.every((v) => v.file === undefined && v.base64 === undefined));
});

test('server vecchio: niente «immagini», gli indirizzi in feedback.images passano senza errori', () => {
  const entrata = { feedback: { text: 'x', images: ['https://firebasestorage.googleapis.com/v0/b/a/o/x.enc'] } };
  assert.deepEqual(scaricaPayload(entrata, { root: ROOT, base: BASE }), entrata);
});

test('se i file non si scrivono, i byte non finiscono in stampa: la voce porta il motivo', () => {
  const p = immaginiSenzaByte(fascicolo(), 'EACCES');
  assert.equal(p.immagini[0].base64, undefined);
  assert.match(p.immagini[0].errore, /EACCES/);
  assert.deepEqual(p.immagini[2], fascicolo().immagini[2]);
});

test('dispatch porta «immagini» a chi vede il feedback, mai a secaudit né al prober', () => {
  const server = { payload: fascicolo() };
  const ruoli = [
    ['new-work', {}], ['verifier', {}], ['fixer', { ripresa: { domanda: 'd', risposta: 'r' } }], ['fixer', {}],
  ];
  for (const [role, extra] of ruoli) {
    const ctx = serverCtx({ role }, { payload: { ...server.payload, ...extra } });
    const p = buildPayload({ role, id: 'a', num: '#900', branch: 'claude/x' }, ctx);
    assert.deepEqual(p.immagini, server.payload.immagini, `${role} ${p.case || ''}`);
  }
  assert.equal(buildPayload({ role: 'secaudit', branch: 'b' }, serverCtx({ role: 'secaudit' }, server, 'diff')).immagini, undefined);
  assert.equal(buildPayload({ role: 'prober' }, serverCtx({ role: 'prober' }, server)).immagini, undefined);
  const senza = buildPayload({ role: 'new-work', id: 'a' }, serverCtx({ role: 'new-work' }, { payload: { feedback: { text: 'x' } } }));
  assert.equal('immagini' in senza, false, 'nessuna immagine: nessun campo');
});

test('un\'immagine rinviata chiesta da sola: stesso endpoint col biglietto, file accanto agli altri senza svuotare', async () => {
  const consegna = scaricaPayload(fascicolo(), { root: ROOT, base: BASE });
  const chiamate = [];
  const fetchImpl = async (url, init) => {
    chiamate.push({ url, body: JSON.parse(init.body) });
    return { status: 200, text: async () => JSON.stringify({ ok: true, immagine: aperta('s3', PNG, 'image/png', { origine: 'segnalazione', n: 3 }) }) };
  };
  const r = await immagine('tkt', 's3', { fetchImpl, sleep: async () => {} });
  assert.equal(r.outcome, 'ok');
  assert.match(chiamate[0].url, /\/routineWork$/);
  assert.deepEqual(chiamate[0].body, { ticket: 'tkt', immagine: 's3' });
  const v = scriviImmagine(r.voce, { root: ROOT, base: BASE });
  assert.ok(readFileSync(v.file).equals(PNG));
  assert.equal(v.base64, undefined);
  assert.ok(existsSync(consegna.immagini[0].file), 'la consegna in corso non si cancella');
});

test('id che il ruolo non vede: rifiuto, non guasto; un 200 senza voce (server vecchio) è un guasto', async () => {
  const risponde = (status, body) => async () => ({ status, text: async () => JSON.stringify(body) });
  const no = await immagine('tkt', 's9', { fetchImpl: risponde(404, { ok: false, reason: 'no_image' }), sleep: async () => {} });
  assert.deepEqual(no, { outcome: 'refused', reason: 'no_image' });
  const vecchio = await immagine('tkt', 's1', { fetchImpl: risponde(200, { ok: true, role: 'new-work', payload: {} }), sleep: async () => {} });
  assert.equal(vecchio.outcome, 'fault');
});

test('argomenti: un id della forma del contratto, biglietto davanti o con --ticket', () => {
  assert.deepEqual(argomentiImmagine(['r1.3']), { id: 'r1.3', ticket: '' });
  assert.deepEqual(argomentiImmagine(['s2'], 'tkt'), { id: 's2', ticket: 'tkt' });
  for (const male of [[], ['s'], ['../s1'], ['s1', 's2'], ['r1']]) assert.ok(argomentiImmagine(male).errore, JSON.stringify(male));
});

function fintoServer(rispondi) {
  const ricevute = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      ricevute.push({ url: req.url, body: json });
      const { status, reply } = rispondi(json);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, port: srv.address().port, ricevute })));
}
function cli(args, env) {
  return new Promise((done) => {
    execFile(process.execPath, [resolve(REPO, 'scripts', 'routine-channel.mjs'), ...args], { env: { ...process.env, ...env } },
      (err, so, se) => done({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
  });
}

test('da riga di comando: il biglietto dall\'ambiente, il file nella cartella della consegna', async () => {
  const { srv, port, ricevute } = await fintoServer((b) => (b.immagine === 's3'
    ? { status: 200, reply: { ok: true, immagine: aperta('s3', PNG, 'image/png', { origine: 'segnalazione', n: 3 }) } }
    : { status: 404, reply: { ok: false, reason: 'no_image' } }));
  const tmp = resolve(BASE, 'tmp-cli');
  const env = { FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: ROOT, FILO_ROUTINE_TICKET: 'tkt-env', TMPDIR: tmp, TEMP: tmp, TMP: tmp };
  try {
    const r = await cli(['immagine', 's3'], env);
    assert.equal(r.code, 0, r.se);
    const v = JSON.parse(r.so);
    assert.ok(readFileSync(v.file).equals(PNG));
    assert.equal(dirname(v.file), cartellaConsegna(ROOT, tmp));
    assert.deepEqual(ricevute[0].body, { ticket: 'tkt-env', immagine: 's3' });
    const no = await cli(['immagine', 's9'], env);
    assert.equal(no.code, 4);
    assert.match(no.se, /s9/);
    const storto = await cli(['immagine', 'x1'], env);
    assert.equal(storto.code, 1);
    assert.equal(ricevute.length, 2, 'un id storto non arriva al server');
  } finally { srv.close(); }
});
