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
  if (fiducia !== null) fields.fiducia = { stringValue: fiducia };
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
  assert.match(detti[0], /^Ho tolto la fiducia a #553 prima di scrivere la nota, perché il biglietto della sessione è sporco/);
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
    assert.match(r.motivo, /^non ho potuto togliere la fiducia \(il server non risponde\)\. Senza, su un feedback fidato la nota non la scrivo/);
    assert.equal(scritture.length, 0);
  });
});

test('se togliendola il server sposta la pratica, la nota non parte: il passaggio era controllato sullo stato di prima', async () => {
  biglietto = SPORCO;
  const doc = pratica('f1');
  of.sessione.togliFiducia = async (id) => { ordine.push(`togli:${id}`); doc.fields.status = { stringValue: 'design' }; return { ok: true }; };
  const detti = [];
  await conRete(doc, async (scritture) => {
    const r = await of.scrivi('f1', 'todo', 'Decisione', { ...OPTS, avviso: (t) => detti.push(t) });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /da «todo» a «design»/);
    assert.equal(scritture.length, 0);
  });
  assert.equal(detti.length, 1, 'la fiducia è tolta comunque, e il terminale lo dice');
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
  for (const fiducia of ['non_fidato', null]) {
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

test('prova a vuoto: sa che la toglierebbe, non la toglie e non lo stampa (server:fondi la usa come controllo)', async () => {
  biglietto = SPORCO;
  await conRete(pratica('f1'), async (scritture) => {
    const r = await of.scrivi('f1', 'todo', 'Decisione', { ...OPTS, dryRun: true, avviso: () => assert.fail('niente da dire') });
    assert.equal(r.ok, true);
    assert.match(r.fiduciaTolta, /sporco/);
    assert.equal(scritture.length, 0);
  });
  assert.deepEqual(ordine, []);
  assert.match(of.avvisoFiduciaTolta('553', 'x', { dryRun: true }), /^\(prova a vuoto\) Toglierei la fiducia a 553 prima di scrivere la nota, perché x/);
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

// Una pratica chiusa: il server finto applica le scritture e toglie la fiducia con la regola della Gestione (solo a una
// pratica aperta), come quello vero.
function chiusa(id) {
  const doc = pratica(id, { status: 'done' });
  doc.fields.statusPublic = { stringValue: 'closed' };
  of.sessione.togliFiducia = async (x) => {
    ordine.push(`togli:${x}`);
    const c = globalThis.SN_MANAGE_REVIEW.fiduciaTogliCheck({ fiducia: doc.fields.fiducia.stringValue, statusPublic: doc.fields.statusPublic.stringValue });
    if (!c.ok) return { ok: false, motivo: c.motivo };
    if (esitoTogli.ok) doc.fields.fiducia = { stringValue: 'non_fidato' };
    return esitoTogli;
  };
  return doc;
}
async function conReteViva(doc, fn) {
  return conRete(doc, async (scritture) => {
    const finta = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const r = await finta(url, init);
      if ((init.method || 'GET') === 'PATCH') Object.assign(doc.fields, JSON.parse(init.body).fields);
      return r;
    };
    return fn(scritture);
  });
}

test('riaprire con la nota una pratica chiusa e fidata, da una sessione sporca: si riapre, poi cade la fiducia, poi la nota', async () => {
  biglietto = SPORCO;
  const doc = chiusa('f1');
  const detti = [];
  await conReteViva(doc, async (scritture) => {
    const r = await of.scrivi('f1', 'todo', 'Riaperta da finish su claude/x: manca il server', { ...OPTS, avviso: (t) => detti.push(t) });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual(ordine, ['scrittura', 'togli:f1', 'scrittura']);
    assert.ok(!scritture[0].maschera.includes('notes'), 'la riapertura parte senza la nota');
    assert.ok(scritture[0].maschera.includes('status'));
    assert.deepEqual(scritture[1].maschera, ['notes', 'updatedAt']);
  });
  assert.equal(doc.fields.status.stringValue, 'todo');
  assert.match(doc.fields.notes.stringValue, /manca il server/);
  assert.equal(doc.fields.fiducia.stringValue, 'non_fidato');
  assert.match(detti[0], /^Ho tolto la fiducia a #553 /, 'senza rif nomina la pratica col numero, non col codice interno');
});

test('riaperta ma la fiducia non cade: la nota non parte, e il motivo dice che la pratica è già riaperta', async () => {
  biglietto = SPORCO;
  esitoTogli = { ok: false, motivo: 'il server non risponde' };
  const doc = chiusa('f1');
  await conReteViva(doc, async (scritture) => {
    const r = await of.scrivi('f1', 'todo', 'Riaperta: istruzioni', { ...OPTS, avviso: () => assert.fail('non è stata tolta') });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Ho già riaperto la pratica \(«done» → «todo»\): rilancia lo stesso comando/);
    assert.equal(scritture.length, 1);
    assert.ok(!scritture[0].maschera.includes('notes'));
  });
  assert.equal(doc.fields.notes.stringValue, '');
  assert.equal(doc.fields.fiducia.stringValue, 'fidato');
});

test('una nota su una pratica chiusa e fidata che resta chiusa, da una sessione sporca: rifiutata senza toccare niente, e dice come fare', async () => {
  biglietto = SPORCO;
  for (const to of ['done', 'archived']) {
    ordine = [];
    const doc = chiusa('f1');
    await conReteViva(doc, async (scritture) => {
      for (const dryRun of [true, false]) {
        const r = await of.scrivi('f1', to, 'Nota', { ...OPTS, dryRun, avviso: () => assert.fail('niente da dire') });
        assert.equal(r.ok, false, to);
        assert.match(r.motivo, /la pratica è chiusa e fidata/);
        assert.match(r.motivo, /Non ho toccato niente/);
        assert.match(r.motivo, /riaprila con la stessa nota/);
      }
      assert.equal(scritture.length, 0);
    });
    assert.deepEqual(ordine, []);
  }
  biglietto = PULITO;
  await conReteViva(chiusa('f1'), async (scritture) => {
    assert.equal((await of.scrivi('f1', 'done', 'Nota', OPTS)).ok, true, 'da una sessione pulita la nota si scrive');
    assert.equal(scritture.length, 1);
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

function lancia(opzioni, ...extra) {
  const dir = cartellaTemporanea('nota-fiducia-1428-');
  const rete = reteFinta(dir, { doc: pratica('f1'), ...opzioni });
  const r = spawnSync(process.execPath, [...rete.importa, join(ROOT, 'scripts', 'owner-feedback.mjs'), 'f1', 'todo', 'Decisione dell’owner', ...extra], {
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
  assert.match(r.stderr, /Ho tolto la fiducia a f1 prima di scrivere la nota, perché il biglietto della sessione è sporco/);
  assert.match(r.stdout, /^OK: f1/m);
});

test('npm run feedback, fiducia che non si toglie: nessuna nota, uscita con errore', () => {
  const r = lancia({ fiducia: 'non_fidato', togli: 'no' });
  assert.equal(r.status, 3, r.stdout);
  assert.equal(r.chiamate.filter((c) => c.chi === 'scrittura').length, 0);
  assert.match(r.stderr, /RIFIUTATO: non ho potuto togliere la fiducia \(prova\)/);
});

test('npm run feedback da una sessione pulita: la nota si scrive e la fiducia resta', () => {
  const r = lancia({ fiducia: 'fidato' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.chiamate.filter((c) => c.chi === 'fiducia').length, 0);
  assert.equal(r.chiamate.filter((c) => c.chi === 'scrittura').length, 1);
  assert.doesNotMatch(r.stderr, /fiducia/i);
});

test('npm run feedback --dry-run da una sessione sporca: dice che la toglierebbe, e non tocca niente', () => {
  const r = lancia({ fiducia: 'non_fidato' }, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.chiamate.filter((c) => c.chi !== 'biglietto'), []);
  assert.match(r.stdout, /^\(prova a vuoto\) Toglierei la fiducia a f1 prima di scrivere la nota, perché il biglietto della sessione è sporco/m);
});
