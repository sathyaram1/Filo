// L'archiviazione a punteggio contro un server finto con lo stato vero:
// #1335: il database consegna solo le chiuse (filtro suo), e il verdetto non cambia;
// #680.2: una segnalazione spostata a mano dopo la prova a secco non si riscrive e compare fra le saltate;
// #1428.1: da un terminale senza biglietto pulito una pratica fidata chiusa si archivia con la sua nota fissa.

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { PULITO, SPORCO } from '../helpers/bigliettoFinto.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
for (const m of ['feedback', 'manageReview', 'boardArchive', 'feedbackPublicView']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const FB = globalThis.SN_FEEDBACK;
const of = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
const { runAutoArchive } = await import(pathToFileURL(join(ROOT, 'scripts', 'auto-archive.mjs')).href);

const ORA = Date.parse('2026-09-20T12:00:00Z');
const VECCHIO = new Date(ORA - 5 * 24 * 3600_000).toISOString();
const NOME = (c, id) => `projects/filo-8b9cb/databases/(default)/documents/${c}/${id}`;
let orologio = 0;
const tempo = () => `2026-10-01T00:00:00.${String(++orologio).padStart(6, '0')}Z`;

const s = (v) => ({ stringValue: v });
const voti = (esito) => ({ mapValue: { fields: Object.fromEntries(['a', 'b'].map((k) => [k,
  { mapValue: { fields: { vote: s(esito), at: s(VECCHIO), weight: { integerValue: '3' } } } }])) } });
const chiusa = (id, extra = {}) => ({ id, fields: {
  status: s('done'), statusPublic: s('closed'), resolvedAt: s(VECCHIO), resolvedInVersion: s('1.0.0'),
  seq: { integerValue: String(id.charCodeAt(0)) }, subSeq: { integerValue: '0' }, fiducia: s('fidato'), notes: s(''),
  clientId: s('local:claude'), senderProof: s('admin'), ...extra } });
const aperta = (id) => ({ id, fields: { status: s('todo'), statusPublic: s('open'), seq: { integerValue: String(id.charCodeAt(0)) }, subSeq: { integerValue: '0' } } });

// Tre chiuse (una da archiviare, una che gli utenti dicono rotta, una che l'owner tiene aperta) e quattro aperte.
function collezione() {
  return {
    feedback: [
      chiusa('c-archiviabile'), chiusa('d-rotta'), chiusa('e-tenuta', { archiveOverride: s('keep_open') }),
      aperta('f-aperta'), aperta('g-aperta'), aperta('h-aperta'), aperta('i-aperta'),
    ].map((d) => ({ ...d, updateTime: tempo() })),
    'feedback-public': [
      { id: 'c-archiviabile', fields: { votes: voti('works') } },
      { id: 'd-rotta', fields: { votes: voti('broken') } },
      { id: 'e-tenuta', fields: { votes: voti('works') } },
    ],
  };
}

const valore = (v) => (v == null ? null : (v.stringValue ?? v.integerValue ?? null));
function passa(doc, where) {
  if (!where) return true;
  const ff = where.fieldFilter;
  if (!ff) return true;
  const a = valore(doc.fields[ff.field.fieldPath]);
  if (a === null) return false;
  if (ff.op === 'EQUAL') return a === valore(ff.value);
  if (ff.op === 'IN') return ff.value.arrayValue.values.map(valore).includes(a);
  return true;
}
const proietta = (doc, campi) => (campi ? Object.fromEntries(Object.entries(doc.fields).filter(([k]) => campi.includes(k))) : { ...doc.fields });

// Il server: filtra, proietta, tiene le scritture e respinge una scrittura condizionata su un documento cambiato.
function server(docs) {
  const st = { docs, consegnate: [], scritte: [], primaDellaScrittura: null, conteggiRotti: false };
  const json = (dati, status = 200) => ({ ok: status < 300, status, json: async () => dati, text: async () => JSON.stringify(dati) });
  st.fetch = async (url, init = {}) => {
    const u = String(url);
    const corpo = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null;
    if (/securetoken|token\?key|oauth/.test(u)) return json({ id_token: 'tok', access_token: 'tok', expires_in: '3600' });
    if (u.includes(':runAggregationQuery')) {
      if (st.conteggiRotti) return json({}, 400);
      const sq = corpo.structuredAggregationQuery.structuredQuery;
      const n = st.docs[sq.from[0].collectionId].filter((d) => passa(d, sq.where)).length;
      return json([{ result: { aggregateFields: { quanti: { integerValue: String(n) } } } }]);
    }
    if (u.includes(':runQuery')) {
      const sq = corpo.structuredQuery;
      const coll = sq.from[0].collectionId;
      let arr = (st.docs[coll] || []).slice().sort((a, b) => a.id.localeCompare(b.id)).filter((d) => passa(d, sq.where));
      const rif = sq.startAt && sq.startAt.values.find((v) => v.referenceValue);
      if (rif) arr = arr.filter((d) => NOME(coll, d.id) > rif.referenceValue);
      if (sq.limit) arr = arr.slice(0, sq.limit);
      const campi = sq.select ? sq.select.fields.map((f) => f.fieldPath) : null;
      if (coll === 'feedback') st.consegnate.push(...arr.map((d) => d.id));
      return json(arr.map((d) => ({ document: { name: NOME(coll, d.id), fields: proietta(d, campi), updateTime: d.updateTime } })));
    }
    const m = u.match(/documents\/feedback\/([^?]+)(?:\?(.*))?$/);
    if (m) {
      const d = st.docs.feedback.find((x) => x.id === decodeURIComponent(m[1]));
      if (!d) return json({}, 404);
      const q = new URLSearchParams(m[2] || '');
      if (init.method === 'PATCH') {
        if (st.primaDellaScrittura) { const f = st.primaDellaScrittura; st.primaDellaScrittura = null; f(d); }
        const condizione = q.get('currentDocument.updateTime');
        if (condizione && condizione !== d.updateTime) return json({ error: { status: 'FAILED_PRECONDITION' } }, 400);
        Object.assign(d.fields, corpo.fields);
        d.updateTime = tempo();
        st.scritte.push(d.id);
        return json({});
      }
      const campi = q.getAll('mask.fieldPaths');
      return json({ name: NOME('feedback', d.id), fields: proietta(d, campi.length ? campi : null), updateTime: d.updateTime });
    }
    return json({ error: `non gestito: ${u}` }, 404);
  };
  st.doc = (id) => st.docs.feedback.find((x) => x.id === id);
  return st;
}

let biglietto = PULITO;
let tolte = [];
const veri = { ...of.sessione };
const veraFetch = globalThis.fetch;
const cifra = globalThis.SN_FEEDBACK_ENC_ENABLED;
const veroRT = process.env.FILO_ADMIN_REFRESH_TOKEN;
beforeEach(() => {
  biglietto = PULITO;
  tolte = [];
  of.sessione.biglietto = async () => biglietto;
  of.sessione.togliFiducia = async (id) => { tolte.push(id); return { ok: true }; };
  // Stato e note in chiaro, così il server finto li rilegge com'è: la cifratura ha le sue prove.
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  process.env.FILO_ADMIN_REFRESH_TOKEN = 'rt-di-prova';
});
after(() => {
  Object.assign(of.sessione, veri);
  globalThis.fetch = veraFetch;
  globalThis.SN_FEEDBACK_ENC_ENABLED = cifra;
  if (veroRT === undefined) delete process.env.FILO_ADMIN_REFRESH_TOKEN; else process.env.FILO_ADMIN_REFRESH_TOKEN = veroRT;
});

async function giro(st, opts) {
  const log = console.log; const warn = console.warn; const err = console.error;
  const dette = [];
  console.log = (...a) => dette.push(a.join(' '));
  console.warn = console.log; console.error = console.log;
  globalThis.fetch = st.fetch;
  try {
    const r = await runAutoArchive({ now: ORA, releasedVersion: '1.0.0', ...opts });
    return { r, dette: dette.join('\n') };
  } finally { console.log = log; console.warn = warn; console.error = err; FB.forgetAllPublic(); }
}

test('#1335: il database consegna solo le chiuse, e il verdetto non cambia', async () => {
  const st = server(collezione());
  const { r } = await giro(st, { dryRun: true, copiaDir: cartellaTemporanea('archivio-chiuse-') });
  assert.deepEqual(r.toArchive.map((a) => a.id), ['c-archiviabile']);
  assert.deepEqual(r.toFlag, ['d-rotta']);
  assert.deepEqual(st.consegnate.sort(), ['c-archiviabile', 'd-rotta', 'e-tenuta'],
    `il server ha consegnato ${st.consegnate.length} segnalazioni: le aperte sono righe pagate e buttate`);
  assert.match(r.rigaLetture, /segnalazioni 3/);
});

test('#1335: una segnalazione senza stato pubblico non sparisce dal verdetto: si leggono tutte, dicendolo', async () => {
  const docs = collezione();
  delete docs.feedback.find((d) => d.id === 'c-archiviabile').fields.statusPublic;
  const st = server(docs);
  const { r, dette } = await giro(st, { dryRun: true, copiaDir: cartellaTemporanea('archivio-senza-stato-') });
  assert.deepEqual(r.toArchive.map((a) => a.id), ['c-archiviabile'], 'la segnalazione senza stato pubblico è uscita dal verdetto');
  assert.equal(st.consegnate.length, 7);
  assert.match(dette, /1 segnalazioni non hanno lo stato pubblico/);
  // E col server che non sa contare: tutte, e lo dice.
  const st2 = server(collezione());
  st2.conteggiRotti = true;
  const due = await giro(st2, { dryRun: true, copiaDir: cartellaTemporanea('archivio-senza-conto-') });
  assert.equal(st2.consegnate.length, 7);
  assert.match(due.dette, /non ha saputo dire se ogni segnalazione ha lo stato pubblico/);
});

test('#1335: con o senza filtro sul server il verdetto è lo stesso: le aperte votate non si archiviano né si segnalano', async () => {
  const conVotiSulleAperte = () => {
    const c = collezione();
    c['feedback-public'].push({ id: 'f-aperta', fields: { votes: voti('works') } }, { id: 'g-aperta', fields: { votes: voti('broken') } });
    return c;
  };
  for (const rotti of [false, true]) {
    const st = server(conVotiSulleAperte());
    st.conteggiRotti = rotti;
    // eslint-disable-next-line no-await-in-loop
    const { r } = await giro(st, { dryRun: true, copiaDir: cartellaTemporanea('archivio-aperte-votate-') });
    assert.equal(st.consegnate.length, rotti ? 7 : 3);
    assert.deepEqual(r.toArchive.map((a) => a.id), ['c-archiviabile'], `conteggi ${rotti ? 'rotti' : 'buoni'}`);
    assert.deepEqual(r.toFlag, ['d-rotta'], `conteggi ${rotti ? 'rotti' : 'buoni'}`);
  }
});

test('#680.2: spostata a mano dopo la prova a secco, la segnalazione non si riscrive ed è fra le saltate', async () => {
  const st = server(collezione());
  const dir = cartellaTemporanea('archivio-a-mano-');
  await giro(st, { dryRun: true, copiaDir: dir });
  // L'owner la riapre a mano.
  Object.assign(st.doc('c-archiviabile').fields, { status: s('todo'), statusPublic: s('open') });
  st.doc('c-archiviabile').updateTime = tempo();
  const { r, dette } = await giro(st, { dryRun: false, copiaDir: dir });
  assert.match(dette, /Riuso la lettura della prova a secco/, 'la prova deve passare dal riuso');
  assert.equal(st.doc('c-archiviabile').fields.status.stringValue, 'todo', 'lo stato vecchio è stato riscritto');
  assert.deepEqual(st.scritte, []);
  assert.deepEqual(r.saltate.map((x) => x.id), ['c-archiviabile']);
  assert.deepEqual(r.toArchive, []);
});

test('#680.2: spostata mentre il giro scrive, la scrittura condizionata non la copre', async () => {
  const st = server(collezione());
  st.primaDellaScrittura = (d) => { d.fields.status = s('todo'); d.fields.statusPublic = s('open'); d.updateTime = tempo(); };
  const { r } = await giro(st, { dryRun: false, usaCopia: false, copiaDir: cartellaTemporanea('archivio-in-mezzo-') });
  assert.equal(st.doc('c-archiviabile').fields.status.stringValue, 'todo');
  assert.deepEqual(r.saltate.map((x) => x.id), ['c-archiviabile']);
});

test('#1428.1: da un terminale senza biglietto pulito la pratica fidata chiusa si archivia, con la sua nota fissa', async () => {
  biglietto = SPORCO;
  const st = server(collezione());
  const { r, dette } = await giro(st, { dryRun: false, usaCopia: false, copiaDir: cartellaTemporanea('archivio-sporco-') });
  const c = st.doc('c-archiviabile');
  assert.equal(c.fields.status.stringValue, 'archived', dette);
  assert.match(c.fields.notes.stringValue, /auto-archiviato \(DC3\): punteggio 2 dopo 24h\+ dalla messa in produzione \(1\.0\.0\)\./);
  assert.equal(c.fields.fiducia.stringValue, 'fidato', 'la nota di uno strumento non toglie la fiducia');
  assert.deepEqual(tolte, []);
  assert.deepEqual(r.toArchive.map((a) => a.id), ['c-archiviabile']);
  assert.doesNotMatch(dette, /non archiviato/);
});
