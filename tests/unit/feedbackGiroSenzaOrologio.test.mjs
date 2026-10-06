// Il giro della Gestione quando chi scrive non firma l'ora (#676): l'ora di
// Firestore dei seguiti, il contatore degli invii, il registro dei worker
// (#676.1) e il tetto dei seguiti (#676.2). Senza rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src', 'shared');
require(join(SRC, 'feedbackLive.js'));
require(join(SRC, 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;
const LIVE = globalThis.SN_FEEDBACK_LIVE;

// Un mondo finto: `ore` è l'ora di Firestore per id, `registro` il registro dei
// worker (o un Error se illeggibile), `numeri` num → id.
function giro(mondo, extra = {}) {
  const log = { versioni: 0, cambiati: 0, versionsOf: [], letti: [], numeri: [], registro: 0 };
  let t = 1_000_000;
  const w = LIVE.makeWatcher({
    now: () => t,
    listVersions: async () => {
      log.versioni += 1;
      return { versions: Object.entries(mondo.ore).map(([_id, _updateTime]) => ({ _id, _updateTime })), complete: true };
    },
    listChangedSince: async () => { log.cambiati += 1; return { rows: mondo.cambiati || [], complete: true }; },
    seguiti: () => mondo.seguiti || [],
    versionsOf: async (ids) => {
      log.versionsOf.push(ids.slice());
      return ids.filter((id) => id in mondo.ore).map((id) => ({ _id: id, _updateTime: mondo.ore[id] }));
    },
    readRows: async (ids) => {
      log.letti.push(ids.slice());
      if (mondo.rotta) throw new Error('rete');
      return ids.map((id) => ({ _id: id, _updateTime: mondo.ore[id], name: `nome ${id}` }));
    },
    submissionCount: async () => {
      if (mondo.invii instanceof Error) throw mondo.invii;
      return mondo.invii ?? null;
    },
    avviiRoutine: async () => {
      log.registro += 1;
      if (mondo.registro instanceof Error) throw mondo.registro;
      return mondo.registro || [];
    },
    idDelNumero: async (num) => { log.numeri.push(num); return (mondo.numeri || {})[num] || null; },
    ...extra,
  });
  return { w, log, avanza: (ms) => { t += ms; } };
}

async function primoGiroEPoi(w, avanza) {
  await w.tick({ force: true }); // riallineamento
  avanza(60_000);
}

test('una scrittura che non firma l\'ora arriva lo stesso: per i seguiti si guarda l\'ora di Firestore', async () => {
  const mondo = { ore: { a: 't1', b: 't1' }, seguiti: ['a'] };
  const { w, log, avanza } = giro(mondo);
  await primoGiroEPoi(w, avanza);
  mondo.ore.a = 't2';
  const r = await w.tick();
  assert.deepEqual(r.rows.map((x) => x._id), ['a']);
  assert.deepEqual(log.letti, [['a']], 'si rilegge solo il mosso');
});

test('un seguito fermo non fa rileggere niente, e nessun seguito non chiede niente', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: ['a'] };
  const { w, log, avanza } = giro(mondo);
  await primoGiroEPoi(w, avanza);
  await w.tick();
  assert.equal(log.letti.length, 0);
  mondo.seguiti = [];
  avanza(60_000);
  await w.tick();
  assert.equal(log.versionsOf.length, 1, 'senza seguiti nessuna versionsOf');
});

test('una rilettura fallita non si dà per fatta: il giro dopo riprova', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: ['a'] };
  const { w, log, avanza } = giro(mondo);
  await primoGiroEPoi(w, avanza);
  mondo.ore.a = 't2';
  mondo.rotta = true;
  await assert.rejects(w.tick());
  mondo.rotta = false;
  avanza(60_000);
  const r = await w.tick();
  assert.deepEqual(r.rows.map((x) => x._id), ['a']);
  assert.equal(log.letti.length, 2);
});

// #676.2: chi resta sopra il tetto non sparisce in silenzio.
test('i seguiti si leggono tutti fino a un tetto largo; sopra, il giro lo dice e si riallinea', async () => {
  const ore = {};
  const tanti = [];
  for (let i = 0; i < 80; i += 1) { ore[`f${i}`] = 't1'; tanti.push(`f${i}`); }
  const mondo = { ore, seguiti: tanti };
  const { w, log, avanza } = giro(mondo);
  assert.ok(LIVE.SEGUITI_TETTO >= 300, 'il tetto è abbondante');
  await primoGiroEPoi(w, avanza);
  const r = await w.tick();
  assert.equal(log.versionsOf[0].length, 80, 'oltre i vecchi 60 nessuno resta fuori');
  assert.equal(r.avvisi, undefined);

  const piccolo = giro({ ore, seguiti: tanti }, { seguitiTetto: 50 });
  await primoGiroEPoi(piccolo.w, piccolo.avanza);
  const r2 = await piccolo.w.tick();
  assert.ok(r2.avvisi.some((m) => /tetto/.test(m)), 'il limite si dice');
  piccolo.avanza(60_000);
  assert.equal((await piccolo.w.tick()).kind, 'reconcile');
});

test('versionsOf legge a pezzi e tutti, senza note né allegati', async () => {
  const vere = globalThis.fetch;
  const corpi = [];
  globalThis.fetch = async (url, opts) => {
    const b = JSON.parse(opts.body);
    corpi.push(b);
    return { ok: true, status: 200, text: async () => '', json: async () => b.documents.map((n) => ({ found: { name: n, fields: {}, updateTime: 't' } })) };
  };
  try {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    const out = await FB.versionsOf(ids);
    assert.equal(out.length, 250);
    assert.ok(corpi.length >= 3);
    assert.ok(corpi.every((b) => b.documents.length <= 100));
    assert.deepEqual(corpi[0].mask.fieldPaths, ['createdAt']);
  } finally { globalThis.fetch = vere; }
});

test('un invio che la domanda per data non vede fa riallineare; il conto che torna no', async () => {
  const mondo = { ore: { a: 't1' }, invii: 10 };
  const { w, avanza } = giro(mondo);
  await primoGiroEPoi(w, avanza);
  mondo.invii = 12;
  mondo.cambiati = [{ _id: 'n1', seq: 11 }];
  await w.tick();
  avanza(60_000);
  assert.equal((await w.tick()).kind, 'reconcile', 'uno dei due mancava');

  const m2 = { ore: {}, invii: 10 };
  const g2 = giro(m2);
  await primoGiroEPoi(g2.w, g2.avanza);
  m2.invii = 11;
  m2.cambiati = [{ _id: 'n', seq: 11 }];
  await g2.w.tick();
  g2.avanza(60_000);
  assert.equal((await g2.w.tick()).kind, 'changed');
});

test('un contatore non letto non vale «niente di nuovo»', async () => {
  const mondo = { ore: {}, invii: 10 };
  const { w, avanza } = giro(mondo);
  await primoGiroEPoi(w, avanza);
  mondo.invii = new Error('rete');
  const r = await w.tick();
  assert.ok(r.avvisi.some((m) => /contatore/.test(m)));
  mondo.invii = 11;
  mondo.cambiati = [];
  avanza(60_000);
  await w.tick();
  avanza(60_000);
  assert.equal((await w.tick()).kind, 'reconcile', 'il confronto resta onesto col valore di prima');
});

// #676.1: il registro si usa per il NOME, non come «qualcosa è cambiato».
test('un worker che parte: si rilegge il SUO feedback e lo si segue, senza riallineare né campionare la coda', async () => {
  const mondo = {
    ore: { a: 't1', b: 't1', c: 't1' },
    registro: [{ startedAt: '2026-10-04T09:00:00Z', num: '41', role: 'verifier' }],
    numeri: { 42: 'b' },
  };
  const { w, log, avanza } = giro(mondo);
  await primoGiroEPoi(w, avanza);
  mondo.registro = [{ startedAt: '2026-10-04T09:05:00Z', num: '42', role: 'new-work' }, ...mondo.registro];
  const r = await w.tick();
  assert.deepEqual(log.numeri, ['42']);
  assert.deepEqual(r.rows.map((x) => x._id), ['b'], 'il feedback preso arriva subito');
  assert.equal(log.versioni, 1, 'nessuna rilettura completa');
  assert.deepEqual(w.seguitiDalRegistro(), ['b']);

  // Il giro dopo lo segue con l'ora di Firestore: una lettura, solo lui.
  mondo.ore.b = 't2';
  avanza(60_000);
  const r2 = await w.tick();
  assert.deepEqual(log.versionsOf.at(-1), ['b']);
  assert.deepEqual(r2.rows.map((x) => x._id), ['b']);
  avanza(60_000);
  assert.equal((await w.tick()).kind, 'changed');
  assert.equal(log.versioni, 1);
});

test('un feedback del registro esce dai seguiti quando la pagina lo segue da sé o dopo il tempo', async () => {
  const mondo = { ore: { b: 't1' }, registro: [], numeri: { 7: 'b' } };
  const { w, avanza } = giro(mondo);
  await primoGiroEPoi(w, avanza);
  mondo.registro = [{ startedAt: 'x', num: '#7', role: 'r' }];
  await w.tick();
  assert.deepEqual(w.seguitiDalRegistro(), ['b']);
  avanza(LIVE.REGISTRO_SEGUI_MS + 1);
  await w.tick(); // questo è il riallineamento della mezz'ora
  avanza(60_000);
  await w.tick();
  assert.deepEqual(w.seguitiDalRegistro(), [], 'scaduto');

  mondo.registro = [{ startedAt: 'y', num: '7', role: 'r' }, ...mondo.registro];
  avanza(60_000);
  await w.tick();
  assert.deepEqual(w.seguitiDalRegistro(), ['b']);
  mondo.seguiti = ['b'];
  avanza(60_000);
  await w.tick();
  assert.deepEqual(w.seguitiDalRegistro(), [], 'ora lo segue la pagina');
});

test('un registro illeggibile non vale «registro svuotato»', async () => {
  const voce = { startedAt: '2026-10-04T09:00:00Z', num: '41', role: 'verifier' };
  const mondo = { ore: { a: 't1' }, registro: [voce], numeri: { 41: 'a' } };
  const { w, log, avanza } = giro(mondo);
  await primoGiroEPoi(w, avanza);
  mondo.registro = new Error('403');
  const r = await w.tick();
  assert.ok(r.avvisi.some((m) => /registro/.test(m)));
  // Torna leggibile con la stessa voce: non è un avvio nuovo.
  mondo.registro = [voce];
  avanza(60_000);
  await w.tick();
  assert.deepEqual(log.numeri, [], 'la voce già vista non si scambia per una nuova');
});

test('idDelNumero: una lettura sul seq, e il sotto-numero sceglie il figlio', async () => {
  const vere = globalThis.fetch;
  const corpi = [];
  const doc = (id, seq, sub) => ({ document: { name: `p/feedback/${id}`, fields: { seq: { integerValue: String(seq) }, ...(sub != null ? { subSeq: { integerValue: String(sub) } } : {}) } } });
  globalThis.fetch = async (url, opts) => {
    corpi.push(JSON.parse(opts.body));
    return { ok: true, status: 200, text: async () => '', json: async () => [doc('padre', 676, null), doc('figlio', 676, 1)] };
  };
  try {
    assert.equal(await FB.idDelNumero('676'), 'padre');
    assert.equal(await FB.idDelNumero('#676.1'), 'figlio');
    assert.equal(await FB.idDelNumero('676.9'), null);
    assert.equal(await FB.idDelNumero('boh'), null);
    assert.equal(corpi.length, 3);
    assert.deepEqual(corpi[0].structuredQuery.where.fieldFilter.value, { integerValue: '676' });
  } finally { globalThis.fetch = vere; }
});

test('il contatore degli invii: una lettura, e «non lo so» non è zero', async () => {
  const vere = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ fields: { value: { integerValue: '774' } } }), text: async () => '' });
    assert.equal(await FB.submissionCount(), 774);
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
    assert.equal(await FB.submissionCount(), null);
  } finally { globalThis.fetch = vere; }
});
