// #680.2: chi riusa l'elenco della prova a secco lo confronta col presente prima di scrivere. Il riordino dei numeri non
// dà un numero già preso, nemmeno col conteggio che non risponde; una segnalazione cambiata a mano non si riscrive e
// compare fra le saltate. Server finto con lo stato vero: si guarda come finiscono le segnalazioni.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const { backfillNumbers } = await import('../../scripts/backfill-feedback-numbers.mjs');

const NOME = (id) => `projects/p/databases/(default)/documents/feedback/${id}`;
let orologio = 0;
const tempo = () => `2026-10-01T00:00:${String(orologio++ % 60).padStart(2, '0')}.${String(orologio).padStart(6, '0')}Z`;

// Il database: tiene i numeri che si scrivono e cambia `updateTime` a ogni scrittura, come quello vero.
function database(righe, { contatore = null } = {}) {
  const db = { docs: righe.map((r) => ({ ...r, updateTime: tempo() })), contatore, senzaConteggio: false, primaDellaScrittura: null };
  const campi = (d) => ({
    name: { stringValue: d.titolo || d.id }, createdAt: { timestampValue: d.createdAt },
    ...(d.seq ? { seq: { integerValue: String(d.seq) }, subSeq: { integerValue: '0' } } : {}),
  });
  const documento = (d) => ({ name: NOME(d.id), fields: campi(d), updateTime: d.updateTime });
  const json = (dati, status = 200) => ({ ok: status < 300, status, json: async () => dati, text: async () => JSON.stringify(dati) });
  db.fetch = async (url, init = {}) => {
    const u = String(url);
    const corpo = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};
    if (u.includes(':runAggregationQuery')) {
      if (db.senzaConteggio) return json({ error: 'niente conteggio' }, 400);
      const ff = corpo.structuredAggregationQuery.structuredQuery.where;
      const n = db.docs.filter((d) => !ff || (d.seq || 0) >= 1).length;
      return json([{ result: { aggregateFields: { quanti: { integerValue: String(n) } } } }]);
    }
    if (u.includes(':runQuery')) {
      const sq = corpo.structuredQuery;
      let arr = db.docs.slice().sort((a, b) => NOME(a.id).localeCompare(NOME(b.id)));
      const comp = sq.where && sq.where.compositeFilter;
      if (comp) {
        const [da, a] = comp.filters.map((f) => Number(f.fieldFilter.value.integerValue));
        arr = arr.filter((d) => d.seq >= da && d.seq <= a).sort((x, y) => x.seq - y.seq);
      } else if (sq.orderBy && sq.orderBy[0].field.fieldPath === 'seq') {
        arr = arr.filter((d) => d.seq).sort((x, y) => y.seq - x.seq);
      }
      const rif = sq.startAt && sq.startAt.values.find((v) => v.referenceValue);
      if (rif) arr = arr.filter((d) => NOME(d.id) > rif.referenceValue);
      if (sq.limit) arr = arr.slice(0, sq.limit);
      return json(arr.map((d) => ({ document: documento(d) })));
    }
    if (u.includes('/counters/')) {
      if ((init.method || 'GET') === 'PATCH') { db.contatore = Number(corpo.fields.value.integerValue); return json({}); }
      return db.contatore == null ? json({}, 404) : json({ fields: { value: { integerValue: String(db.contatore) } }, updateTime: 'T' });
    }
    const p = u.match(/documents\/feedback\/([^?]+)\?(.*)$/);
    if (p && init.method === 'PATCH') {
      const d = db.docs.find((x) => x.id === decodeURIComponent(p[1]));
      if (db.primaDellaScrittura) { const f = db.primaDellaScrittura; db.primaDellaScrittura = null; f(d); }
      const condizione = new URLSearchParams(p[2]).get('currentDocument.updateTime');
      if (condizione && condizione !== d.updateTime) return json({ error: { status: 'FAILED_PRECONDITION' } }, 400);
      if (corpo.fields.seq) d.seq = Number(corpo.fields.seq.integerValue);
      d.updateTime = tempo();
      return json({});
    }
    return json({ error: 'non gestito' }, 404);
  };
  // Un invio dell'app: il numero se lo prende da sé.
  db.arriva = (id, seq) => db.docs.push({ id, titolo: id, createdAt: '2026-09-25T10:00:00Z', ...(seq ? { seq } : {}), updateTime: tempo() });
  db.aMano = (id, seq) => { const d = db.docs.find((x) => x.id === id); d.seq = seq; d.updateTime = tempo(); };
  return db;
}

function partenza() {
  return [
    { id: 'a', titolo: 'prima', createdAt: '2026-01-01T10:00:00Z', seq: 1 },
    { id: 'b', titolo: 'seconda', createdAt: '2026-02-01T10:00:00Z', seq: 2 },
    { id: 'c', titolo: 'terza', createdAt: '2026-03-01T10:00:00Z', seq: 3 },
    { id: 'd', titolo: 'senza numero', createdAt: '2026-04-01T10:00:00Z' },
    { id: 'e', titolo: 'senza numero anche lei', createdAt: '2026-05-01T10:00:00Z' },
  ];
}

async function giro(db, opts) {
  const vera = globalThis.fetch;
  const log = console.log; const warn = console.warn; const err = console.error;
  const dette = [];
  console.log = (...a) => dette.push(a.join(' '));
  console.warn = console.log; console.error = console.log;
  globalThis.fetch = db.fetch;
  try {
    const r = await backfillNumbers('tok', opts);
    return { r, dette: dette.join('\n') };
  } finally { globalThis.fetch = vera; console.log = log; console.warn = warn; console.error = err; }
}

function numeriDoppi(db) {
  const visti = new Map();
  const doppi = [];
  for (const d of db.docs) {
    if (!d.seq) continue;
    if (visti.has(d.seq)) doppi.push(`#${d.seq}: ${visti.get(d.seq)} e ${d.id}`);
    else visti.set(d.seq, d.id);
  }
  return doppi;
}

// Prova a secco, poi `nelFrattempo`, poi l'applicazione entro la finestra del riuso.
async function scena({ senzaConteggio = false, nelFrattempo, primaDellaScrittura = null }) {
  const db = database(partenza());
  db.senzaConteggio = senzaConteggio;
  const dir = cartellaTemporanea('riuso-presente-');
  const t0 = 1_700_000_000_000;
  await giro(db, { dry: true, now: t0, copiaDir: dir });
  nelFrattempo(db);
  db.primaDellaScrittura = primaDellaScrittura;
  const esito = await giro(db, { dry: false, now: t0 + 30_000, copiaDir: dir });
  return { db, ...esito };
}

test('(a) col conteggio che non risponde, nessun numero già preso viene assegnato', async () => {
  const { db, dette } = await scena({ senzaConteggio: true, nelFrattempo: (x) => x.arriva('z', 4) });
  assert.deepEqual(numeriDoppi(db), [], dette);
  assert.deepEqual(db.docs.filter((d) => !d.seq).map((d) => d.id), [], 'rifiutare il riuso non deve lasciarne indietro');
  assert.match(dette, /non la riuso: il server non ha saputo contare/);
});

test('(b) col conteggio che risponde i numeri restano liberi', async () => {
  const { db, dette } = await scena({ nelFrattempo: (x) => x.arriva('z', 4) });
  assert.deepEqual(numeriDoppi(db), [], dette);
  assert.deepEqual(db.docs.filter((d) => !d.seq).map((d) => d.id), []);
});

test('un numero che la prova a secco dava ed è stato preso, coi conteggi uguali, non si ridà', async () => {
  // Una segnalazione numerata se ne va e ne arriva una col #4: i conti tornano, il #4 no.
  const { db, dette } = await scena({ nelFrattempo: (x) => { x.docs = x.docs.filter((d) => d.id !== 'c'); x.arriva('z', 4); } });
  assert.deepEqual(numeriDoppi(db), [], dette);
  assert.match(dette, /il numero #4, che la prova a secco dava, ora è di un'altra segnalazione/);
});

test('(c) un numero dato a mano dopo la prova a secco non si riscrive, e la segnalazione è fra le saltate', async () => {
  const { db, r, dette } = await scena({ nelFrattempo: (x) => x.aMano('d', 9) });
  assert.equal(db.docs.find((d) => d.id === 'd').seq, 9, 'il numero dato a mano è stato riscritto');
  assert.deepEqual(numeriDoppi(db), []);
  assert.ok(db.docs.find((d) => d.id === 'e').seq, 'l\'altra andava numerata');
  assert.deepEqual(r.saltate.map((s) => s.id), ['d']);
  assert.match(dette, /Saltate perché cambiate nel frattempo \(1\)[\s\S]*↷ d:/);
});

test('(c) un numero dato a mano mentre il giro scrive: la scrittura condizionata non lo copre', async () => {
  const { db, r, dette } = await scena({
    nelFrattempo: () => {},
    primaDellaScrittura: (d) => { d.seq = 9; d.updateTime = tempo(); },
  });
  assert.equal(db.docs.find((d) => d.id === 'd').seq, 9, `il numero dato a mano è stato riscritto\n${dette}`);
  assert.deepEqual(numeriDoppi(db), []);
  assert.deepEqual(r.saltate.map((s) => s.id), ['d']);
  assert.equal(r.failures, 0, 'una segnalazione cambiata non è un guasto');
});
