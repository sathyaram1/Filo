// «Aspetta #N» (#903): i numeri che l'owner scrive, i rifiuti alla scrittura (inesistenti, sé stesso, giri, più di
// venti), lo stato di ciascun aspettato e la sezione di Gestione. Le due strade da riga di comando, con la rete finta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
require(join(ROOT, 'src', 'shared', 'feedbackTransitions.js'));
require(join(ROOT, 'src', 'shared', 'feedbackStatus.js'));
require(join(ROOT, 'src', 'shared', 'feedbackAttese.js'));
require(join(ROOT, 'src', 'shared', 'manageReview.js'));
const A = globalThis.SN_FB_ATTESE;
const MR = globalThis.SN_MANAGE_REVIEW;

test('i numeri si leggono come li scrive l\'owner, e un numero storto si rifiuta col motivo', () => {
  assert.deepEqual(A.leggiNumeri('aspetta #676, #663.2'), { ok: true, numeri: ['676', '663.2'] });
  assert.deepEqual(A.leggiNumeri('676 663.2 e 12; 676'), { ok: true, numeri: ['676', '663.2', '12'] });
  assert.deepEqual(A.leggiNumeri(['#12', '13.0']), { ok: true, numeri: ['12', '13'] });
  assert.deepEqual(A.leggiNumeri(''), { ok: true, numeri: [] });
  const storto = A.leggiNumeri('676, abc');
  assert.equal(storto.ok, false);
  assert.match(storto.motivo, /«abc» non è un numero di feedback/);
});

test('più di venti numeri si rifiutano col numero, mai un taglio', () => {
  const ventuno = Array.from({ length: 21 }, (_, i) => String(i + 1)).join(',');
  const r = A.leggiNumeri(ventuno);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /sono 21 numeri: un feedback ne aspetta al più 20, togline 1/);
  assert.equal(A.leggiNumeri(Array.from({ length: 20 }, (_, i) => String(i + 1))).numeri.length, 20);
});

// Un piccolo archivio finto: numero → id, e le attese già scritte.
function archivio(attese = {}) {
  const ids = { 12: 'id12', 13: 'id13', 14: 'id14', 903: 'id903', '663.2': 'id663-2' };
  return {
    risolvi: async (n) => ids[n] || null,
    leggiAttese: async (lista) => new Map(lista.map((id) => [id, attese[id] || []])),
  };
}

test('valida: inesistenti, sé stesso (per numero e per id) e giri si rifiutano, con il motivo', async () => {
  const base = { id: 'id903', num: '903' };
  let r = await A.valida({ ...base, numeri: ['12', '999'], ...archivio() });
  assert.deepEqual(r, { ok: false, motivo: '#999 non esiste' });

  r = await A.valida({ ...base, numeri: ['903'], ...archivio() });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /#903 è questo stesso feedback/);
  r = await A.valida({ id: 'id903', num: '', numeri: ['903'], ...archivio() });
  assert.match(r.motivo, /questo stesso feedback/, 'anche senza il proprio numero, dall\'id');

  // A aspetta B, B aspetta A.
  r = await A.valida({ ...base, numeri: ['12'], ...archivio({ id12: [{ id: 'id903', num: '903' }] }) });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'giro di attese: #903 aspetterebbe #12, che aspetta #903');
  // Un giro più lungo: 903 → 13 → 14 → 903.
  r = await A.valida({ ...base, numeri: ['13'], ...archivio({ id13: [{ id: 'id14', num: '14' }], id14: [{ id: 'id903', num: '903' }] }) });
  assert.equal(r.motivo, 'giro di attese: #903 aspetterebbe #13, che aspetta #14, che aspetta #903');

  r = await A.valida({ ...base, numeri: ['12', '663.2'], ...archivio({ id12: [{ id: 'id13', num: '13' }] }) });
  assert.deepEqual(r, { ok: true, attese: [{ id: 'id12', num: '12' }, { id: 'id663-2', num: '663.2' }] });
});

test('lo stato di ciascun aspettato: fuso è done, o archiviato con la versione', () => {
  const S = A.STATO;
  assert.equal(A.statoAttesa({ status: 'done' }), S.FUSO);
  assert.equal(A.statoAttesa({ status: 'archived', resolvedInVersion: '0.2.230' }), S.FUSO);
  assert.equal(A.statoAttesa({ status: 'archived' }), S.CHIUSO);
  assert.equal(A.statoAttesa({ status: 'attack_confirmed' }), S.CHIUSO);
  assert.equal(A.statoAttesa({ status: 'todo' }), S.APERTO);
  assert.equal(A.statoAttesa({ missing: true }), S.CANCELLATO);
  assert.equal(A.statoAttesa(undefined), S.IGNOTO);
  assert.equal(A.statoAttesa({ status: 'FENC1:xyz' }), S.IGNOTO);
});

test('in Gestione chi aspetta un non fuso sta fra quelli che aspettano; fusi tutti, torna In coda', () => {
  const b = { _id: 'b', status: 'todo', seq: 12 };
  const a = { _id: 'a', status: 'todo', seq: 903, waitsFor: [{ id: 'b', num: '12' }] };
  const trova = (lista) => (id) => lista.find((f) => f._id === id);
  assert.equal(MR.manageTabFor(a, { trovaAtteso: trova([a, b]) }), 'waiting');
  assert.equal(MR.manageTabFor(a), 'waiting', 'un aspettato mai letto si aspetta, come per la coda');
  assert.equal(MR.manageTabFor(a, { trovaAtteso: trova([a, { ...b, status: 'done' }]) }), 'queue');
  // Già preso da una routine: resta fra quelli in lavorazione.
  assert.equal(MR.manageTabFor({ ...a, status: 'working' }, { trovaAtteso: trova([a, b]) }), 'queue');
  // Nei Ricevuti resta nei Ricevuti: aspetta comunque una decisione dell'owner.
  assert.equal(MR.manageTabFor({ ...a, status: 'design' }, { trovaAtteso: trova([a, b]) }), 'inbox');
  const counts = MR.manageTabCounts([a, b], { trovaAtteso: trova([a, b]) });
  assert.equal(counts.waiting, 1);
  assert.equal(counts.queue, 1);
  assert.deepEqual(MR.listForManageTab([a, b], 'waiting', { trovaAtteso: trova([a, b]) }).map((f) => f._id), ['a']);
  assert.deepEqual(MR.ownerActions(a, { trovaAtteso: trova([a, b]) }).map((x) => x.key), ['resolve', 'archive']);
});

test('le regole ammettono il campo solo come elenco da 1 a 20, nel ramo admin e alla creazione admin', () => {
  const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  assert.match(rules, /function waitsForValido\(d\) \{\s*return !\('waitsFor' in d\)\s*\|\| \(d\.waitsFor is list && d\.waitsFor\.size\(\) >= 1 && d\.waitsFor\.size\(\) <= 20\);/);
  assert.match(rules, /allow create: if isAdmin\(\)[^;]*waitsForValido\(request\.resource\.data\)/);
  const blocco = rules.slice(rules.indexOf("'localApproval',"), rules.indexOf("'capabilityGapId'])"));
  assert.match(blocco, /'waitsFor',/);
  assert.equal(rules.match(/&& waitsForValido\(request\.resource\.data\)/g).length, 2, 'creazione admin e aggiornamento admin');
  assert.equal(A.MAX, 20);
});

// ── Da riga di comando, rete finta ──────────────────────────────────────────

const owner = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
const claude = await import(pathToFileURL(join(ROOT, 'scripts', 'claude-feedback.mjs')).href);

// Documenti per id; una query `seq == N` risponde con i documenti di quel numero.
function reteFinta(docs) {
  const scritte = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes(':runQuery')) {
      const seq = JSON.parse(opts.body).structuredQuery.where.fieldFilter.value.integerValue;
      return ok(Object.entries(docs).filter(([, d]) => String(d.seq) === seq).map(([id, d]) => ({
        document: { name: `x/feedback/${id}`, fields: { subSeq: { integerValue: String(d.subSeq || 0) } } },
      })));
    }
    const id = decodeURIComponent(u.split('/feedback/')[1].split('?')[0]);
    if ((opts.method || 'GET') === 'PATCH') {
      scritte.push({ id, url: u, body: JSON.parse(opts.body) });
      return ok({});
    }
    const d = docs[id];
    if (!d) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const fields = { seq: { integerValue: String(d.seq) }, subSeq: { integerValue: String(d.subSeq || 0) } };
    if (d.waitsFor) {
      fields.waitsFor = { arrayValue: { values: d.waitsFor.map((w) => ({ mapValue: { fields: { id: { stringValue: w.id }, num: { stringValue: w.num } } } })) } };
    }
    return ok({ name: `x/feedback/${id}`, fields });
  };
  return { scritte, ripristina: () => { globalThis.fetch = vero; } };
}
const DOCS = { id903: { seq: 903 }, id676: { seq: 676 }, 'id663-2': { seq: 663, subSeq: 2 } };

test('npm run feedback -- <id> --aspetta: scrive solo le attese (stato invariato), --aspetta-niente le toglie', async () => {
  const rete = reteFinta(DOCS);
  try {
    let r = await owner.segnaAttese('id903', '676,663.2', { bearer: 'tok' });
    assert.deepEqual(r, { ok: true, attese: [{ id: 'id676', num: '676' }, { id: 'id663-2', num: '663.2' }] });
    assert.equal(rete.scritte.length, 1);
    const w = rete.scritte[0];
    assert.match(w.url, /updateMask\.fieldPaths=waitsFor&updateMask\.fieldPaths=updatedAt$/);
    assert.deepEqual(Object.keys(w.body.fields).sort(), ['updatedAt', 'waitsFor'], 'lo stato non si tocca');
    assert.equal(w.body.fields.waitsFor.arrayValue.values.length, 2);

    r = await owner.segnaAttese('id903', '', { bearer: 'tok' });
    assert.deepEqual(r, { ok: true, attese: [] });
    assert.match(rete.scritte[1].url, /updateMask\.fieldPaths=waitsFor/);
    assert.deepEqual(Object.keys(rete.scritte[1].body.fields), ['updatedAt'], 'nominato nella maschera e assente: cancellato');
  } finally { rete.ripristina(); }
});

test('--aspetta rifiuta inesistenti, sé stesso e giri senza scrivere niente', async () => {
  const rete = reteFinta({ ...DOCS, id676: { seq: 676, waitsFor: [{ id: 'id903', num: '903' }] } });
  try {
    assert.deepEqual(await owner.segnaAttese('id903', '999', { bearer: 'tok' }), { ok: false, motivo: '#999 non esiste' });
    assert.match((await owner.segnaAttese('id903', '903', { bearer: 'tok' })).motivo, /stesso feedback/);
    assert.match((await owner.segnaAttese('id903', '676', { bearer: 'tok' })).motivo, /giro di attese: #903 aspetterebbe #676, che aspetta #903/);
    assert.deepEqual(rete.scritte, []);
  } finally { rete.ripristina(); }
});

test('npm run feedback:apri --aspetta: il feedback nasce con le attese; un numero inesistente non apre niente', async () => {
  const rete = reteFinta(DOCS);
  const credVera = claude.credenziale.ottieni;
  const routineVera = claude.ambiente.routine;
  const submitVero = globalThis.SN_FEEDBACK.submit;
  const visti = [];
  claude.credenziale.ottieni = async () => ({ idToken: 'tok-owner' });
  claude.ambiente.routine = () => false;
  globalThis.SN_FEEDBACK.submit = async (payload, opts) => { visti.push(opts); return { id: 'nuovo', seq: 1001, senderProof: 'admin', images: [], files: [] }; };
  const log = console.log; const err = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    assert.equal(await claude.main(['Titolo', 'Testo', '--non-locale', '--aspetta', '676,663.2']), claude.EXIT.FATTO);
    assert.deepEqual(visti[0].waitsFor, [{ id: 'id676', num: '676' }, { id: 'id663-2', num: '663.2' }]);
    assert.equal(await claude.main(['Titolo', 'Testo', '--non-locale', '--aspetta', '999']), claude.EXIT.RIFIUTATO);
    assert.equal(visti.length, 1, 'niente aperto');
  } finally {
    console.log = log; console.error = err;
    claude.credenziale.ottieni = credVera;
    claude.ambiente.routine = routineVera;
    globalThis.SN_FEEDBACK.submit = submitVero;
    rete.ripristina();
  }
});
