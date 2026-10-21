// #1428: una nota scritta su un feedback fidato da una sessione senza biglietto pulito gli toglie prima la fiducia; se
// toglierla non riesce la nota non parte. Le scritture senza testo per chi lavora restano come sono. Rete finta.

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';
import { PULITO, SPORCO, reteFinta } from '../helpers/bigliettoFinto.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const of = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
const { togliFiducia, URL_FIDUCIA } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'togli-fiducia.mjs')).href);

const OPTS = { bearer: 'tok-finto' };
const SEGNO = { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1' } } } };

function pratica(id, { fiducia = 'fidato', status = 'todo', notes = '' } = {}) {
  const fields = {
    seq: { integerValue: '553' }, clientId: { stringValue: 'local:claude' }, senderProof: { stringValue: 'admin' },
    status: { stringValue: status }, statusPublic: { stringValue: 'open' }, notes: { stringValue: notes }, localOnly: SEGNO,
  };
  if (fiducia !== undefined) fields.fiducia = { stringValue: fiducia };
  return { name: `projects/p/databases/(default)/documents/feedback/${id}`, fields };
}

// `ordine` tiene insieme le scritture e la fiducia tolta: la seconda deve venire prima della prima.
let ordine = [];
let biglietto = PULITO;
let esitoTogli = { ok: true };
let lettureBiglietto = 0;
const veri = { ...of.sessione };
beforeEach(() => {
  ordine = [];
  biglietto = PULITO;
  esitoTogli = { ok: true };
  lettureBiglietto = 0;
  of.sessione.biglietto = async () => { lettureBiglietto += 1; if (biglietto instanceof Error) throw biglietto; return biglietto; };
  of.sessione.togliFiducia = async (id) => { ordine.push(`togli:${id}`); return esitoTogli; };
});
after(() => Object.assign(of.sessione, veri));

// Lo stato e le note in chiaro, così la rete finta li rilegge com'è: la cifratura ha le sue prove.
async function conRete(doc, fn) {
  const vero = globalThis.fetch;
  const cifra = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  const scritture = [];
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method || 'GET') === 'PATCH') {
      const u = new URL(String(url));
      scritture.push({ maschera: u.searchParams.getAll('updateMask.fieldPaths'), campi: JSON.parse(init.body).fields });
      ordine.push('scrittura');
      return new Response('{}', { status: 200 });
    }
    return new Response(JSON.stringify(doc), { status: 200 });
  };
  try { return await fn(scritture); } finally { globalThis.fetch = vero; globalThis.SN_FEEDBACK_ENC_ENABLED = cifra; }
}

test('biglietto sporco: la fiducia si toglie PRIMA della nota, e il terminale lo dice', async () => {
  biglietto = SPORCO;
  const detti = [];
  await conRete(pratica('f1'), async (scritture) => {
    const r = await of.scrivi('f1', 'todo', 'Decisione: va fatto così', { ...OPTS, rif: '#553', avviso: (t) => detti.push(t) });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual(ordine, ['togli:f1', 'scrittura']);
    assert.match(scritture[0].campi.notes.stringValue, /Decisione: va fatto così/);
    assert.match(r.fiduciaTolta, /sporco/);
  });
  assert.equal(detti.length, 1);
  assert.match(detti[0], /Fiducia di #553 tolta prima della nota/);
  assert.match(detti[0], /Gestione/);
  assert.match(detti[0], /Segna fidato/);
});

test('biglietto pulito: la fiducia resta e la nota si scrive', async () => {
  await conRete(pratica('f1'), async (scritture) => {
    const r = await of.scrivi('f1', 'todo', 'Decisione', { ...OPTS, avviso: () => assert.fail('niente da dire') });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual(ordine, ['scrittura']);
    assert.ok(scritture[0].maschera.includes('notes'));
    assert.equal(r.fiduciaTolta, undefined);
  });
});

test('toglierla non riesce: nessuna nota scritta, e il motivo lo dice', async () => {
  biglietto = SPORCO;
  esitoTogli = { ok: false, motivo: 'il server non risponde' };
  await conRete(pratica('f1'), async (scritture) => {
    const r = await of.scrivi('f1', 'todo', 'Decisione', { ...OPTS, avviso: () => assert.fail('non è stata tolta') });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /il server non risponde/);
    assert.match(r.motivo, /la nota da qui non la scrivo/);
    assert.equal(scritture.length, 0);
  });
});

test('senza biglietto, in attesa, illeggibile o col lettore guasto: tutti la tolgono', async () => {
  for (const b of [null, { ...PULITO, inAttesa: 1 }, { ...PULITO, fiducia: 'non_fidato', errore: 'server giù' }, new Error('rotto')]) {
    biglietto = b;
    ordine = [];
    await conRete(pratica('f1'), async () => {
      const r = await of.scrivi('f1', 'todo', 'Decisione', { ...OPTS, avviso: () => {} });
      assert.equal(r.ok, true, r.motivo);
      assert.deepEqual(ordine, ['togli:f1', 'scrittura'], `biglietto ${JSON.stringify(b && b.message ? b.message : b)}`);
    });
  }
  assert.match(of.bigliettoNonPulito(null), /non ha un biglietto/);
  assert.match(of.bigliettoNonPulito({ ...PULITO, inAttesa: 2 }), /non ha ancora ricevuto/);
  assert.match(of.bigliettoNonPulito({ errore: 'x' }), /non si legge \(x\)/);
  assert.match(of.bigliettoNonPulito(SPORCO), /sporco/);
  assert.equal(of.bigliettoNonPulito(PULITO), '');
});

test('un feedback già non fidato (o senza fiducia) non chiede nemmeno il biglietto', async () => {
  biglietto = SPORCO;
  for (const fiducia of ['non_fidato', undefined]) {
    await conRete(pratica('f1', { fiducia }), async (scritture) => {
      const r = await of.scrivi('f1', 'todo', 'Decisione', { ...OPTS, avviso: () => assert.fail('niente da dire') });
      assert.equal(r.ok, true, r.motivo);
      assert.equal(scritture.length, 1);
    });
  }
  assert.equal(lettureBiglietto, 0);
  assert.deepEqual(ordine, ['scrittura', 'scrittura']);
});

test('senza testo per chi lavora resta tutto com’è: stato senza nota, solo spazi, stella, attese, nota già presente', async () => {
  biglietto = SPORCO;
  await conRete(pratica('f1'), async (scritture) => {
    assert.equal((await of.scrivi('f1', 'todo', '', OPTS)).ok, true);
    assert.equal((await of.scrivi('f1', 'todo', '   ', { ...OPTS, starred: true })).ok, true);
    assert.equal((await of.segnaAttese('f1', '', OPTS)).ok, true);
    assert.equal(scritture.length, 3);
    assert.ok(scritture.every((s) => !s.maschera.includes('notes')));
  });
  await conRete(pratica('f1', { notes: 'Decisione' }), async () => {
    assert.equal((await of.scrivi('f1', 'todo', 'Decisione', OPTS)).ok, true, 'la stessa nota non aggiunge niente');
  });
  assert.equal(lettureBiglietto, 0);
  assert.ok(!ordine.some((x) => x.startsWith('togli')));
});

test('prova a vuoto: dice che la toglierebbe, e non la toglie', async () => {
  biglietto = SPORCO;
  const detti = [];
  await conRete(pratica('f1'), async (scritture) => {
    const r = await of.scrivi('f1', 'todo', 'Decisione', { ...OPTS, dryRun: true, rif: '553', avviso: (t) => detti.push(t) });
    assert.equal(r.ok, true);
    assert.match(r.fiduciaTolta, /sporco/);
    assert.equal(scritture.length, 0);
  });
  assert.deepEqual(ordine, []);
  assert.match(detti[0], /^\(prova a vuoto\) toglierei la fiducia a 553/);
});

test('la nota di un giro (verify-local, orchestratore, server:fondi) passa dalla stessa regola', async () => {
  biglietto = SPORCO;
  await conRete(pratica('f1'), async (scritture) => {
    const r = await of.annotaPratica('f1', 'Giro 2: verdetto rosso', { ...OPTS, avviso: () => {} });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual(ordine, ['togli:f1', 'scrittura']);
    assert.match(scritture[0].campi.notes.stringValue, /Giro 2/);
  });
});

// ── La chiamata al server ─────────────────────────────────────────────────────

function rispondi(status, corpo, visto) {
  return async (url, init) => { visto.push({ url: String(url), init }); return new Response(JSON.stringify(corpo), { status }); };
}

test('togliFiducia chiede solo «togli», col token dell’owner, e legge l’esito del server', async () => {
  const visto = [];
  const ok = await togliFiducia('f1', { fetchImpl: rispondi(200, { result: { ok: true } }, visto), idToken: async () => 'tok' });
  assert.deepEqual(ok, { ok: true });
  assert.equal(visto[0].url, URL_FIDUCIA);
  assert.equal(visto[0].init.method, 'POST');
  assert.equal(visto[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(visto[0].init.body), { data: { op: 'togli', feedbackId: 'f1' } });

  const no = await togliFiducia('f1', { fetchImpl: rispondi(200, { result: { ok: false, reason: 'not_found', detail: 'feedback inesistente' } }, []), idToken: async () => 'tok' });
  assert.deepEqual(no, { ok: false, motivo: 'feedback inesistente' });
  assert.match((await togliFiducia('f1', { fetchImpl: rispondi(404, {}, []), idToken: async () => 'tok' })).motivo, /non è pubblicata/);
  assert.match((await togliFiducia('f1', { fetchImpl: rispondi(403, {}, []), idToken: async () => 'tok' })).motivo, /proprietario/);
  assert.match((await togliFiducia('f1', { fetchImpl: async () => { throw new TypeError('fetch failed'); }, idToken: async () => 'tok' })).motivo, /fetch failed/);
  assert.match((await togliFiducia('f1', { fetchImpl: rispondi(200, {}, []), idToken: async () => '' })).motivo, /credenziale/);
  assert.equal((await togliFiducia('', { fetchImpl: () => assert.fail('niente chiamata') })).ok, false);
  assert.match((await togliFiducia('f1')).motivo, /dentro una prova/, 'senza rete finta il server vero non si tocca');
});

// ── Lo script, come lo lancia una sessione ────────────────────────────────────

function lancia(opzioni) {
  const dir = cartellaTemporanea('nota-fiducia-1428-');
  const rete = reteFinta(dir, { doc: pratica('f1'), ...opzioni });
  const r = spawnSync(process.execPath, [...rete.importa, join(ROOT, 'scripts', 'owner-feedback.mjs'), 'f1', 'todo', 'Decisione dell’owner'], {
    encoding: 'utf8', timeout: TETTO_ATTESA_MS, env: rete.env,
  });
  return { ...r, chiamate: rete.chiamate() };
}

test('npm run feedback da una sessione sporca: toglie la fiducia, poi scrive la nota, e lo dice', () => {
  const r = lancia({ fiducia: 'non_fidato' });
  assert.equal(r.status, 0, r.stderr);
  const chi = r.chiamate.map((c) => c.chi).filter((c) => c !== 'biglietto');
  assert.deepEqual(chi, ['fiducia', 'scrittura']);
  assert.deepEqual(r.chiamate.find((c) => c.chi === 'fiducia').data, { op: 'togli', feedbackId: 'f1' });
  assert.ok(r.chiamate.find((c) => c.chi === 'scrittura').campi.includes('notes'));
  assert.match(r.stderr, /Fiducia di f1 tolta prima della nota: il biglietto della sessione è sporco/);
  assert.match(r.stdout, /^OK: f1/m);
});

test('npm run feedback, fiducia che non si toglie: nessuna nota, uscita con errore', () => {
  const r = lancia({ fiducia: 'non_fidato', togli: 'no' });
  assert.equal(r.status, 3, r.stdout);
  assert.equal(r.chiamate.filter((c) => c.chi === 'scrittura').length, 0);
  assert.match(r.stderr, /RIFIUTATO: la fiducia non si è tolta \(prova\)/);
});

test('npm run feedback da una sessione pulita: la nota si scrive e la fiducia resta', () => {
  const r = lancia({ fiducia: 'fidato' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.chiamate.filter((c) => c.chi === 'fiducia').length, 0);
  assert.equal(r.chiamate.filter((c) => c.chi === 'scrittura').length, 1);
  assert.doesNotMatch(r.stderr, /Fiducia/);
});
