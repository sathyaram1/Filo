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
  // Il segno dei lavori server non ha più una scheda sua (#1575): chi aspetta sta fra quelli che aspettano anche col segno.
  const server = { ...a, localOnly: { by: 'routine', at: 1790000000000 } };
  assert.equal(MR.manageTabFor(server, { trovaAtteso: trova([server, b]) }), 'waiting');
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
    if (d.status) fields.status = { stringValue: d.status };
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
    assert.equal(r.ok, true);
    assert.deepEqual(r.attese, [{ id: 'id676', num: '676' }, { id: 'id663-2', num: '663.2' }]);
    assert.equal(rete.scritte.length, 1);
    const w = rete.scritte[0];
    assert.match(w.url, /updateMask\.fieldPaths=waitsFor&updateMask\.fieldPaths=updatedAt$/);
    assert.deepEqual(Object.keys(w.body.fields).sort(), ['updatedAt', 'waitsFor'], 'lo stato non si tocca');
    assert.equal(w.body.fields.waitsFor.arrayValue.values.length, 2);

    r = await owner.segnaAttese('id903', '', { bearer: 'tok' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.attese, []);
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

test('il pacchetto si aggiunge alle attese di una segnalazione unita senza togliere quelle che c\'erano', async () => {
  const rete = reteFinta({ ...DOCS, id951: { seq: 951 }, id903: { seq: 903, status: 'todo', waitsFor: [{ id: 'id676', num: '676' }] } });
  try {
    const letta = await owner.segnalazioneDaUnire('903', { bearer: 'tok' });
    assert.deepEqual({ ...letta, priorita: letta.priorita ?? null }, { ok: true, id: 'id903', num: '903', stato: 'todo', priorita: null, locale: false, attese: [{ id: 'id676', num: '676' }], ramo: '', unisce: [] });
    assert.equal((await owner.segnalazioneDaUnire('999', { bearer: 'tok' })).inesistente, true);
    const r = await owner.aggiungiAttesa('id903', { id: 'id951', num: '951' }, { bearer: 'tok' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.attese, [{ id: 'id676', num: '676' }, { id: 'id951', num: '951' }]);
    assert.equal(rete.scritte.length, 1);
    rete.scritte.length = 0;
    const gia = await owner.aggiungiAttesa('id903', { id: 'id676', num: '676' }, { bearer: 'tok' });
    assert.equal(gia.gia, true, 'un\'attesa che c\'è già non si riscrive');
    assert.equal(rete.scritte.length, 0);
  } finally { rete.ripristina(); }
  const senza = reteFinta({ ...DOCS, id951: { seq: 951 }, id903: { seq: 903, waitsFor: [{ id: 'idVecchio', num: '' }] } });
  try {
    const r = await owner.aggiungiAttesa('id903', { id: 'id951', num: '951' }, { bearer: 'tok' });
    assert.equal(r.ok, false, 'un\'attesa senza numero non sparisce in silenzio');
    assert.match(r.motivo, /idVecchio, senza numero/);
    assert.equal(senza.scritte.length, 0);
  } finally { senza.ripristina(); }
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

import { spawnSync } from 'node:child_process';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

test('npm run feedback senza stato: un\'opzione in più si rifiuta prima delle credenziali, non si perde in silenzio', () => {
  const lancia = (...args) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'owner-feedback.mjs'), 'fid', ...args, '--dry-run'],
    { encoding: 'utf8', timeout: TETTO_ATTESA_MS, env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: '' } });
  for (const attesa of [['--aspetta', '676'], ['--aspetta-niente'], ['--frase', 'ciao'], ['--solo-locale'], ['--serve-locale', 'perché']]) {
    for (const [altra, atteso] of [[['--branch', 'claude/x'], /--branch vale solo insieme a uno stato/], [['--reason', 'm'], /--reason vale solo/],
      [['--come-routine'], /--come-routine vale solo/], [['--starred'], /--starred vale solo/]]) {
      const r = lancia(...attesa, ...altra);
      assert.equal(r.status, 1, `${attesa.join(' ')} ${altra.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, atteso);
    }
  }
  for (const [a, b] of [[['--aspetta', '676'], ['--frase', 'ciao']], [['--aspetta-niente'], ['--solo-locale']], [['--frase', 'ciao'], ['--non-locale']],
    [['--serve-locale', 'perché'], ['--frase', 'ciao']], [['--aspetta', '676'], ['--non-locale']]]) {
    const r = lancia(...a, ...b);
    assert.equal(r.status, 1, `${a.join(' ')} ${b.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /sono due comandi: lancia un comando per ciascuno — non ho toccato niente/);
  }
  const conStato = lancia('todo', 'nota', '--aspetta', '676');
  assert.equal(conStato.status, 1);
  assert.match(conStato.stderr, /--aspetta va da solo, senza stato né nota/);
});

test('valida: le attese già scritte non si risolvono di nuovo, e quelle da tenere per id restano', async () => {
  const risolvi = async (n) => ({ 952: 'f952', 953: 'f953' }[n] || null);
  const leggiAttese = async () => new Map();
  const gia = [{ id: 'via951', num: '951' }, { id: 'f952', num: '952' }];
  // #951 è stato cancellato: riscritto col suo numero non si rifiuta.
  assert.deepEqual(await A.valida({ id: 'f950', num: '950', numeri: ['951', '953'], gia, risolvi, leggiAttese }),
    { ok: true, attese: [{ id: 'via951', num: '951' }, { id: 'f953', num: '953' }] });
  // Per id: resta solo chi è già scritto; un id che non c'è non entra.
  assert.deepEqual(await A.valida({ id: 'f950', num: '950', numeri: ['953'], gia, tieni: ['via951', 'estraneo'], risolvi, leggiAttese }),
    { ok: true, attese: [{ id: 'f953', num: '953' }, { id: 'via951', num: '951' }] });
  // Il tetto conta anche quelle tenute.
  const venti = Array.from({ length: 20 }, (_, i) => String(900 + i));
  const tanti = await A.valida({ id: 'f950', num: '950', numeri: venti, gia, tieni: ['via951'], risolvi: async (n) => `f${n}`, leggiAttese });
  assert.equal(tanti.ok, false);
  assert.match(tanti.motivo, /sono 21 numeri/);
});

test('--aspetta da riga di comando: dice quelle che sostituisce e cosa succede dopo per lo stato della pratica', async () => {
  const conAttesa = (status) => ({ ...DOCS, id903: { seq: 903, status, waitsFor: [{ id: 'id663-2', num: '663.2' }, { id: 'via951', num: '951' }] } });
  let rete = reteFinta(conAttesa('design'));
  try {
    const r = await owner.segnaAttese('id903', '676,951', { bearer: 'tok' });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual(r.attese.map((w) => w.num), ['676', '951'], 'il cancellato #951, già scritto, non si rifiuta');
    assert.deepEqual(r.tolte, [{ id: 'id663-2', num: '663.2' }]);
    const testo = owner.rispostaAttese('903', r);
    assert.match(testo, /Tolta l’attesa su #663\.2, che c’era prima/);
    assert.match(testo, /È nei Ricevuti: in coda lo mette l’owner/);
    assert.doesNotMatch(testo, /entra in coda da solo/);
  } finally { rete.ripristina(); }
  rete = reteFinta(conAttesa('todo'));
  try {
    const r = await owner.segnaAttese('id903', '676', { bearer: 'tok', dryRun: true });
    assert.deepEqual(rete.scritte, []);
    assert.match(owner.rispostaAttese('903', r), /scriverei «aspetta #676» e toglierei quelle su #663\.2, #951, che c’erano prima/);
    const scritta = await owner.segnaAttese('id903', '676', { bearer: 'tok' });
    assert.match(owner.rispostaAttese('903', scritta), /Tolte le attese su #663\.2, #951.*poi entra in coda da solo/);
    assert.match(owner.rispostaAttese('903', await owner.segnaAttese('id903', '', { bearer: 'tok' })), /non aspetta più niente \(tolte le attese su #663\.2, #951\)/);
  } finally { rete.ripristina(); }
});

// La priorità risale le attese (#1630): se B aspetta A, A vale almeno B, lungo la catena e solo verso l'alto.
function grafo(docs) {
  const letture = [];
  return {
    letture,
    leggi: async (ids) => { letture.push(ids.slice()); return new Map(ids.map((id) => [id, docs[id] || { missing: true }])); },
  };
}
const aspetta = (...coppie) => coppie.map(([id, num]) => ({ id, num }));

test('eredità: la priorità scende lungo tutta la catena di attese, e la nota dice da chi', async () => {
  // C (3) aspetta B (1), che aspetta A (nessuna) e D (2).
  const docs = {
    B: { num: '20', status: 'todo', priority: 1, waitsFor: aspetta(['A', '10'], ['D', '11']) },
    A: { num: '10', status: 'unlabeled', waitsFor: [] },
    D: { num: '11', status: 'design', priority: '2', waitsFor: [] },
  };
  const g = grafo(docs);
  const r = await A.ereditaPriorita({ id: 'C', num: '30', priority: 3, waitsFor: aspetta(['B', '20']) }, g.leggi);
  assert.equal(r.ok, true);
  assert.deepEqual(r.alzati, [
    { id: 'B', num: '20', prima: 1, dopo: 3, da: { id: 'C', num: '30' } },
    { id: 'A', num: '10', prima: 0, dopo: 3, da: { id: 'B', num: '20' } },
    { id: 'D', num: '11', prima: 2, dopo: 3, da: { id: 'B', num: '20' } },
  ]);
  assert.deepEqual(g.letture, [['B'], ['A', 'D']], 'una lettura per anello della catena, non una per feedback');
  assert.equal(A.notaEredita(r.alzati[1]), 'priorità 3: la eredita da #20, che lo aspetta');
  assert.equal(A.notaEredita({ dopo: 2, da: { id: 'x' } }), 'priorità 2: la eredita da un feedback senza numero, che lo aspetta');
});

test('eredità: mai verso il basso, e chi vale già quanto la fonte non si tocca', async () => {
  const docs = {
    A: { num: '10', status: 'todo', priority: 3, waitsFor: aspetta(['Z', '9']) },
    P: { num: '12', status: 'todo', priority: 2, waitsFor: [] },
    Z: { num: '9', status: 'todo', priority: 1, waitsFor: [] },
  };
  const r = await A.ereditaPriorita({ id: 'B', num: '20', priority: 2, waitsFor: aspetta(['A', '10'], ['P', '12']) }, grafo(docs).leggi);
  assert.deepEqual(r.alzati, [], 'un aspettato più alto resta com\'è, uno uguale anche');
  for (const nessuna of [0, null, undefined, '', '0']) {
    const v = await A.ereditaPriorita({ id: 'B', priority: nessuna, waitsFor: aspetta(['Z', '9']) }, grafo(docs).leggi);
    assert.deepEqual(v.alzati, [], `fonte senza priorità (${nessuna}) non alza nessuno`);
  }

  const conAttese = { priority: 3, waitsFor: aspetta(['A', '10']) };
  assert.equal(A.scattaEredita({ ...conAttese }, { ...conAttese, priority: 1 }), false, 'B riabbassato: niente si riabbassa');
  assert.equal(A.scattaEredita({ priority: 3, waitsFor: aspetta(['A', '10'], ['Z', '9']) }, conAttese), false, 'attesa tolta: niente si riabbassa');
  assert.equal(A.scattaEredita(conAttese, { ...conAttese }), false, 'scrittura senza cambi di priorità né di attese');
});

test('eredità: quando scatta (priorità salita, attesa nuova o cambiata, nascita con attese)', () => {
  const w = aspetta(['A', '10']);
  assert.equal(A.scattaEredita({ priority: 1, waitsFor: w }, { priority: 2, waitsFor: w }), true, 'priorità salita');
  assert.equal(A.scattaEredita({ priority: 2, waitsFor: [] }, { priority: 2, waitsFor: w }), true, 'attesa aggiunta');
  assert.equal(A.scattaEredita({ priority: 2, waitsFor: w }, { priority: 2, waitsFor: aspetta(['Z', '9']) }), true, 'attesa cambiata');
  assert.equal(A.scattaEredita(null, { priority: 3, waitsFor: w }), true, 'alla nascita con --aspetta');
  assert.equal(A.scattaEredita({ priority: 'FENC:xyz', waitsFor: w }, { priority: 2, waitsFor: w }), true, 'da illeggibile a leggibile');
  assert.equal(A.scattaEredita(null, { waitsFor: w }), false, 'senza priorità non c\'è niente da ereditare');
  assert.equal(A.scattaEredita({ priority: 1 }, { priority: 3 }), false, 'senza attese nessuno eredita');
});

test('eredità: fusi, chiusi, archiviati e cancellati non salgono e non passano la priorità ai loro aspettati', async () => {
  const sotto = { num: '1', status: 'todo', priority: 0, waitsFor: [] };
  const chiusi = {
    fuso: { num: '2', status: 'done', priority: 1, waitsFor: aspetta(['sotto', '1']) },
    verificato: { num: '3', status: 'archived', resolvedInVersion: '1.0.9', priority: 1, waitsFor: aspetta(['sotto', '1']) },
    archiviato: { num: '4', status: 'archived', priority: 1, waitsFor: aspetta(['sotto', '1']) },
    attacco: { num: '5', status: 'attack_confirmed', priority: 0, waitsFor: aspetta(['sotto', '1']) },
    spam: { num: '6', status: 'spam_confirmed', priority: 0, waitsFor: aspetta(['sotto', '1']) },
    sotto,
  };
  const ids = ['fuso', 'verificato', 'archiviato', 'attacco', 'spam', 'sparito'];
  const r = await A.ereditaPriorita({ id: 'B', num: '20', priority: 3, waitsFor: aspetta(...ids.map((id) => [id, ''])) }, grafo(chiusi).leggi);
  assert.equal(r.ok, true);
  assert.deepEqual(r.alzati, []);
  assert.deepEqual(r.illeggibili, []);

  // Ogni stato non chiuso è aperto, Ricevuti e domande comprese.
  for (const status of ['unlabeled', 'aligned', 'todo', 'working', 'revision_capability', 'revision_security', 'design']) {
    const v = await A.ereditaPriorita({ id: 'B', priority: 2, waitsFor: aspetta(['X', '7']) }, grafo({ X: { num: '7', status, priority: 1 } }).leggi);
    assert.deepEqual(v.alzati.map((a) => a.dopo), [2], status);
  }
});

test('eredità: uno stato o una priorità non letti non si riscrivono, e si dicono', async () => {
  const docs = {
    cifrato: { num: '7', status: 'FENC:abc', priority: 0, waitsFor: [] },
    prio: { num: '8', status: 'todo', priority: 'FENC:def', waitsFor: [] },
  };
  const r = await A.ereditaPriorita({ id: 'B', priority: 3, waitsFor: aspetta(['cifrato', '7'], ['prio', '8']) }, grafo(docs).leggi);
  assert.deepEqual(r.alzati, []);
  assert.deepEqual(r.illeggibili, [{ id: 'cifrato', num: '7' }, { id: 'prio', num: '8' }]);
  assert.equal(A.prioritaDi({ priority: 'FENC:def' }), null);
  assert.equal(A.prioritaDi({ priority: ' 2 ' }), 2);
  assert.equal(A.prioritaDi({ priority: 7 }), 0);
});

test('eredità: un giro di attese rimasto nei dati non la fa girare per sempre, e la fonte non si rialza', async () => {
  const docs = {
    A: { num: '10', status: 'todo', priority: 0, waitsFor: aspetta(['B', '20']) },
    B: { num: '20', status: 'todo', priority: 0, waitsFor: aspetta(['A', '10'], ['S', '1']) },
  };
  const r = await A.ereditaPriorita({ id: 'S', num: '1', priority: 2, waitsFor: aspetta(['A', '10']) }, grafo(docs).leggi);
  assert.deepEqual(r.alzati.map((a) => a.id), ['A', 'B']);
});

test('eredità: oltre il tetto di feedback visitati si rifiuta col numero, mai un taglio', async () => {
  const docs = {};
  for (let i = 0; i < 2100; i++) docs[`n${i}`] = { num: String(i + 1), status: 'todo', priority: 0, waitsFor: aspetta([`n${i + 1}`, String(i + 2)]) };
  const r = await A.ereditaPriorita({ id: 'S', priority: 1, waitsFor: aspetta(['n0', '1']) }, grafo(docs).leggi);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /superano 2000 feedback/);
});
