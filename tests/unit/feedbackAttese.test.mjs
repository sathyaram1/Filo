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

test('scheda del manutentore: fra le attese che bloccano solo le non fuse, col loro stato; le fuse a parte (#2262)', () => {
  const docs = {
    fuso: { status: 'done' }, archOk: { status: 'archived', resolvedInVersion: '0.2.230' },
    aperto: { status: 'todo' }, doppione: { status: 'archived' }, via: { missing: true },
  };
  const fb = { waitsFor: [
    { id: 'fuso', num: '1302' }, { id: 'archOk', num: '1562' }, { id: 'aperto', num: '1563' },
    { id: 'doppione', num: '1600' }, { id: 'via', num: '1601' }, { id: 'mai', num: '1602' },
  ] };
  const r = A.atteseDellaScheda(fb, (id) => docs[id]);
  assert.deepEqual(r.aspetta, [
    { num: '1563', stato: 'aperto' }, { num: '1600', stato: 'chiuso' }, { num: '1601', stato: 'cancellato' }, { num: '1602', stato: 'ignoto' },
  ]);
  assert.deepEqual(r.aspettava, ['1302', '1562']);
  assert.equal(r.aspetta.length > 0, A.aspettaAncora(fb, (id) => docs[id]), 'stessa regola della coda');
  const sciolto = { waitsFor: [{ id: 'fuso', num: '1302' }] };
  assert.deepEqual(A.atteseDellaScheda(sciolto, (id) => docs[id]), { aspetta: [], aspettava: ['1302'] });
  assert.equal(A.aspettaAncora(sciolto, (id) => docs[id]), false);
  assert.deepEqual(A.atteseDellaScheda({}, () => undefined), { aspetta: [], aspettava: [] });
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

// Documenti per id; una query `seq == N` risponde con i documenti di quel numero. Ogni documento ha la sua versione
// (`updateTime`), e una scrittura con la versione come condizione su un documento cambiato si rifiuta come fa Firestore.
// `viva`: le scritture delle attese si applicano. `rete.intanto(docs)`, se c'è, scrive un altro prima della prossima PATCH.
function reteFinta(docs, { viva = false } = {}) {
  const scritte = [];
  const vero = globalThis.fetch;
  const rete = { scritte, rifiutate: 0, intanto: null };
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
      if (rete.intanto) { const f = rete.intanto; rete.intanto = null; f(docs); }
      const body = JSON.parse(opts.body);
      const condizione = new URL(u).searchParams.get('currentDocument.updateTime');
      if (condizione && condizione !== `v${docs[id].v || 1}`) {
        rete.rifiutate += 1;
        const errore = { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'the stored version does not match the required base version' } };
        return { ok: false, status: 400, json: async () => errore, text: async () => JSON.stringify(errore) };
      }
      scritte.push({ id, url: u, body });
      if (viva) {
        docs[id].waitsFor = (body.fields.waitsFor?.arrayValue?.values || []).map((v) => ({ id: v.mapValue.fields.id.stringValue, num: v.mapValue.fields.num.stringValue }));
        docs[id].v = (docs[id].v || 1) + 1;
      }
      return ok({});
    }
    const d = docs[id];
    if (!d) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const fields = { seq: { integerValue: String(d.seq) }, subSeq: { integerValue: String(d.subSeq || 0) } };
    if (d.status) fields.status = { stringValue: d.status };
    if (d.resolvedInVersion) fields.resolvedInVersion = { stringValue: d.resolvedInVersion };
    if (d.unitoIn) fields.unitoIn = { stringValue: d.unitoIn };
    if (d.waitsFor) {
      fields.waitsFor = { arrayValue: { values: d.waitsFor.map((w) => ({ mapValue: { fields: { id: { stringValue: w.id }, num: { stringValue: w.num } } } })) } };
    }
    return ok({ name: `x/feedback/${id}`, fields, updateTime: `v${d.v || 1}` });
  };
  rete.ripristina = () => { globalThis.fetch = vero; };
  return rete;
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
    assert.match(w.url, /updateMask\.fieldPaths=waitsFor&updateMask\.fieldPaths=updatedAt&currentDocument\.updateTime=v1$/, 'si scrive solo sulla versione letta');
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

test('chi aspettava una segnalazione unita aspetta il pacchetto, e le sue altre attese restano', async () => {
  const rete = reteFinta({
    ...DOCS, id951: { seq: 951 }, id812: { seq: 812 }, id815: { seq: 815 },
    id903: { seq: 903, status: 'todo', waitsFor: [{ id: 'id676', num: '676' }, { id: 'id812', num: '812' }, { id: 'id815', num: '815' }] },
    id904: { seq: 904, status: 'todo', unitoIn: 'id951' },
  });
  try {
    const letta = await owner.segnalazioneDaUnire('903', { bearer: 'tok' });
    assert.deepEqual({ ...letta, priorita: letta.priorita ?? null }, { ok: true, id: 'id903', num: '903', stato: 'todo', priorita: null, locale: false, attese: [{ id: 'id676', num: '676' }, { id: 'id812', num: '812' }, { id: 'id815', num: '815' }], ramo: '', unisce: [], unitoIn: '', fidato: false });
    assert.equal((await owner.segnalazioneDaUnire('904', { bearer: 'tok' })).unitoIn, 'id951', 'il rimando a un pacchetto si legge: senza, il controllo dei pacchetti già presi non lo vede');
    assert.equal((await owner.segnalazioneDaUnire('999', { bearer: 'tok' })).inesistente, true);
    const r = await owner.spostaAttese('id903', ['id812', 'id815'], { id: 'id951', num: '951' }, { bearer: 'tok' });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual(r.attese, [{ id: 'id676', num: '676' }, { id: 'id951', num: '951' }], 'due unite dello stesso pacchetto diventano un\'attesa sola');
    assert.equal(rete.scritte.length, 1);
    rete.scritte.length = 0;
    const gia = await owner.spostaAttese('id903', ['id999'], { id: 'id951', num: '951' }, { bearer: 'tok' });
    assert.equal(gia.gia, true, 'chi non aspetta nessuna unita non si riscrive');
    assert.equal(rete.scritte.length, 0);
  } finally { rete.ripristina(); }
  const senza = reteFinta({ ...DOCS, id951: { seq: 951 }, id903: { seq: 903, waitsFor: [{ id: 'idVecchio', num: '' }, { id: 'id812', num: '812' }] } });
  try {
    const r = await owner.spostaAttese('id903', ['id812'], { id: 'id951', num: '951' }, { bearer: 'tok' });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual(r.attese, [{ id: 'id951', num: '951' }, { id: 'idVecchio', num: '' }], 'un\'attesa senza numero resta, per id');
    assert.equal(senza.scritte.length, 1);
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
    const r = await owner.segnaAttese('id903', '676,951', { bearer: 'tok', sostituisci: true });
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
    const r = await owner.segnaAttese('id903', '676', { bearer: 'tok', dryRun: true, sostituisci: true });
    assert.deepEqual(rete.scritte, []);
    assert.match(owner.rispostaAttese('903', r), /scriverei «aspetta #676» e toglierei quelle su #663\.2, #951, che c’erano prima/);
    const scritta = await owner.segnaAttese('id903', '676', { bearer: 'tok', sostituisci: true });
    assert.match(owner.rispostaAttese('903', scritta), /Tolte le attese su #663\.2, #951.*poi entra in coda da solo/);
    assert.match(owner.rispostaAttese('903', await owner.segnaAttese('id903', '', { bearer: 'tok', sostituisci: true })), /non aspetta più niente \(tolte le attese su #663\.2, #951\)/);
  } finally { rete.ripristina(); }
});

// ── #1756: aggiungere senza sostituire, e sostituire solo dicendolo ─────────

const CASO_1294 = {
  ...DOCS, id1741: { seq: 1741, status: 'todo' }, id1756: { seq: 1756, status: 'todo' }, id567: { seq: 567, status: 'done' },
  id600: { seq: 600, status: 'archived', resolvedInVersion: '0.2.200' }, id601: { seq: 601, status: 'archived' },
  id1294: { seq: 1294, status: 'todo', waitsFor: [{ id: 'id1741', num: '1741' }, { id: 'idVecchio', num: '' }, { id: 'id567', num: '567' }] },
};
const scrittiIn = (w) => w.body.fields.waitsFor.arrayValue.values.map((v) => v.mapValue.fields.num.stringValue || v.mapValue.fields.id.stringValue);

test('--aspetta-anche unisce alle attese che ci sono, senza doppioni, e non perde quelle senza numero', async () => {
  const rete = reteFinta(CASO_1294);
  try {
    const r = await owner.segnaAttese('id1294', '1756,1741,#1756', { bearer: 'tok', aggiungi: true });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual(r.attese.map((w) => w.num || w.id), ['1741', '567', '1756', 'idVecchio']);
    assert.deepEqual(r.aggiunte, [{ id: 'id1756', num: '1756' }]);
    assert.deepEqual(r.tolte, []);
    assert.equal(rete.scritte.length, 1);
    assert.deepEqual(scrittiIn(rete.scritte[0]).sort(), ['1741', '1756', '567', 'idVecchio']);
    assert.match(owner.rispostaAttese('1294', r), /^1294: aspetta #1741, #567, #1756, un feedback senza numero\. Aggiunta l’attesa su #1756\. Nessuna routine/);

    rete.scritte.length = 0;
    const gia = await owner.segnaAttese('id1294', '1741', { bearer: 'tok', aggiungi: true });
    assert.equal(gia.invariato, true);
    assert.equal(rete.scritte.length, 0, 'niente di nuovo, niente scritto');
    assert.match(owner.rispostaAttese('1294', gia), /aspettava già #1741, #567, un feedback senza numero: non ho scritto niente/);
    assert.match(owner.rispostaAttese('1294', await owner.segnaAttese('id1294', '1756', { bearer: 'tok', aggiungi: true, dryRun: true })),
      /^\[dry-run\] 1294: aggiungerei #1756, e aspetterebbe #1741, #567, #1756, un feedback senza numero, stato invariato$/);
    assert.equal(rete.scritte.length, 0);

    // Le regole di sempre valgono sull'elenco unito: il tetto conta anche quelle che c'erano.
    assert.match((await owner.segnaAttese('id1294', '1294', { bearer: 'tok', aggiungi: true })).motivo, /stesso feedback/);
    const diciotto = Array.from({ length: 18 }, (_, i) => String(1000 + i)).join(',');
    assert.match((await owner.segnaAttese('id1294', diciotto, { bearer: 'tok', aggiungi: true })).motivo, /sono 21 numeri: un feedback ne aspetta al più 20, togline 1/);
    assert.equal(rete.scritte.length, 0);
  } finally { rete.ripristina(); }
});

test('--aspetta che toglierebbe attese non fuse rifiuta senza scrivere; passa con sostituisci, o se toglie solo fuse', async () => {
  const rete = reteFinta(CASO_1294);
  try {
    // Il caso del 28/10: chi metteva l'attesa sul pacchetto nuovo cancellava quelle che c'erano.
    const r = await owner.segnaAttese('id1294', '1756', { bearer: 'tok' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.vive.map((w) => [w.num || w.id, w.stato]), [['1741', 'aperto'], ['idVecchio', 'cancellato']], 'la fusa #567 non conta');
    const testo = owner.rifiutoSostituzione('#1294', ['1756'], r);
    assert.match(testo, /^RIFIUTATO: --aspetta sostituisce l’elenco intero, e toglierebbe le attese su #1741 \(non ancora fuso\), un feedback senza numero \(cancellato\): non ho toccato niente\./);
    assert.match(testo, /npm run feedback -- 1294 --aspetta-anche 1756\n/);
    assert.match(testo, /npm run feedback -- 1294 --aspetta 1756 --sostituisci$/);
    assert.equal((await owner.segnaAttese('id1294', '1756', { bearer: 'tok', dryRun: true })).ok, false, 'anche a vuoto lo dice');
    assert.deepEqual(rete.scritte, []);

    // Toglie solo la fusa #567 (e tiene le altre): passa.
    const soloFusa = reteFinta({ ...CASO_1294, id1294: { seq: 1294, status: 'todo', waitsFor: [{ id: 'id1741', num: '1741' }, { id: 'id567', num: '567' }, { id: 'id600', num: '600' }] } });
    try {
      const ok = await owner.segnaAttese('id1294', '1741,1756', { bearer: 'tok' });
      assert.equal(ok.ok, true, ok.motivo);
      assert.deepEqual(ok.tolte.map((w) => w.num), ['567', '600'], 'done, e archived con la versione: fuse tutte e due');
      assert.deepEqual(scrittiIn(soloFusa.scritte[0]), ['1741', '1756']);
    } finally { soloFusa.ripristina(); }

    const chiusa = reteFinta({ ...CASO_1294, id1294: { seq: 1294, status: 'todo', waitsFor: [{ id: 'id601', num: '601' }] } });
    try {
      const no = await owner.segnaAttese('id1294', '1756', { bearer: 'tok' });
      assert.deepEqual(no.vive.map((w) => [w.num, w.stato]), [['601', 'chiuso']], 'archiviato senza fusione non è fuso');
    } finally { chiusa.ripristina(); }

    const conSostituisci = reteFinta(CASO_1294);
    try {
      const si = await owner.segnaAttese('id1294', '1756', { bearer: 'tok', sostituisci: true });
      assert.equal(si.ok, true, si.motivo);
      assert.deepEqual(scrittiIn(conSostituisci.scritte[0]), ['1756']);
      assert.match(owner.rispostaAttese('1294', si), /Tolte le attese su #1741, un feedback senza numero, #567, che c’erano prima/);
    } finally { conSostituisci.ripristina(); }
  } finally { rete.ripristina(); }
});

test('uno stato che non si decifra o non si legge conta da non fuso: l\'attesa non si toglie senza dirlo', async () => {
  const rete = reteFinta({ ...CASO_1294, id1741: { seq: 1741, status: 'FENC1:illeggibile' } });
  try {
    const { statiInRete } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'stati-attese.mjs')).href);
    const stati = await statiInRete([{ id: 'id1741', num: '1741' }, { id: 'id567', num: '' }, { id: 'id601', num: '601' }],
      { bearer: 'tok', decifra: async (g) => (g.status.startsWith('FENC1:') ? { status: '[cifrato — chiave privata non configurata]' } : g) });
    assert.deepEqual(stati, [{ id: 'id1741', num: '1741', stato: 'ignoto' }, { id: 'id567', num: '567', stato: 'fuso' }, { id: 'id601', num: '601', stato: 'chiuso' }],
      'il numero mancante si prende dal documento');
    const giu = await statiInRete([{ id: 'id1741', num: '1741' }], { bearer: 'tok', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    assert.deepEqual(giu, [{ id: 'id1741', num: '1741', stato: 'ignoto' }]);
  } finally { rete.ripristina(); }
});

test('npm run feedback: le forme nuove delle attese si rifiutano male accoppiate, prima delle credenziali', () => {
  const lancia = (...args) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'owner-feedback.mjs'), 'fid', ...args, '--dry-run'],
    { encoding: 'utf8', timeout: TETTO_ATTESA_MS, env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: '' } });
  for (const [args, atteso] of [
    [['--sostituisci'], /--sostituisci vale solo con --aspetta <numeri>/],
    [['--aspetta-anche', '676', '--sostituisci'], /--sostituisci vale solo con --aspetta <numeri>/],
    [['--aspetta-niente', '--sostituisci'], /--sostituisci vale solo con --aspetta <numeri>/],
    [['--aspetta', '676', '--aspetta-anche', '12'], /--aspetta e --aspetta-anche insieme/],
    [['--aspetta-anche', '676', '--frase', 'ciao'], /sono due comandi/],
    [['todo', 'nota', '--aspetta-anche', '676'], /--aspetta-anche va da solo, senza stato né nota/],
    [['--aspetta-anche', '676', '--priorita', '2'], /--priorita senza stato va da sola, non con --aspetta-anche/],
  ]) {
    const r = lancia(...args);
    assert.equal(r.status, 1, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, atteso, args.join(' '));
    assert.match(r.stderr, /RIFIUTATO/);
  }
  const aiuto = spawnSync(process.execPath, [join(ROOT, 'scripts', 'owner-feedback.mjs'), '--help'], { encoding: 'utf8', timeout: TETTO_ATTESA_MS });
  assert.match(aiuto.stderr, /--aspetta-anche 676,663\.2 +\(aggiunge attese a quelle che ci sono/);
  assert.match(aiuto.stderr, /--aspetta 676,663\.2 \[--sostituisci\] \| --aspetta-niente/);
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

// ── #1756.1: due scritture contemporanee non si cancellano ──────────────────

test('daScrivereSu: l\'elenco intero sostituisce; il gesto tiene quelle lette tranne le tolte, quelle senza numero per id', () => {
  const prima = [{ id: 'a', num: '10' }, { id: 'b', num: '' }, { id: 'c', num: '12' }];
  assert.deepEqual(A.daScrivereSu(prima, { numeri: ['5'] }), { numeri: ['5'], tieni: [] });
  assert.deepEqual(A.daScrivereSu(prima, { aggiungi: ['#13', '10'] }), { numeri: ['10', '12', '13'], tieni: ['b'] });
  assert.deepEqual(A.daScrivereSu(prima, { togli: ['a', 'b'], aggiungi: ['20'] }), { numeri: ['12', '20'], tieni: [] });
  assert.deepEqual(A.daScrivereSu(prima, { togli: ['a', 'b', 'c'] }), { numeri: [], tieni: [] });
  assert.deepEqual(A.daScrivereSu([], {}), { numeri: [], tieni: [] });
});

test('conflittoDiScrittura: la versione non è più quella letta (o il documento non c\'è più); il resto è un errore', () => {
  assert.equal(A.conflittoDiScrittura(400, '{"error":{"status":"FAILED_PRECONDITION"}}'), true);
  assert.equal(A.conflittoDiScrittura(409, ''), true);
  assert.equal(A.conflittoDiScrittura(412, ''), true);
  assert.equal(A.conflittoDiScrittura(404, ''), true);
  assert.equal(A.conflittoDiScrittura(400, '{"error":{"status":"INVALID_ARGUMENT"}}'), false);
  assert.equal(A.conflittoDiScrittura(403, 'PERMISSION_DENIED'), false);
  assert.equal(A.conflittoDiScrittura(503, ''), false);
});

test('scriviSullaLettura: sul conflitto rilegge e ricalcola; al tetto si ferma col numero, senza scrivere', async () => {
  let versione = 1;
  let elenco = ['x'];
  const lette = [];
  const r = await A.scriviSullaLettura({
    leggi: async () => ({ versione: `v${versione}`, elenco: elenco.slice() }),
    calcola: async (letto) => { lette.push(letto.versione); return { scrivi: [...letto.elenco, 'mia'] }; },
    scrivi: async (dati, v) => {
      // Al primo giro un altro scrive prima di noi.
      if (versione === 1) { elenco = ['x', 'sua']; versione = 2; }
      if (v !== `v${versione}`) return { conflitto: true };
      elenco = dati; versione += 1;
      return { ok: true, attese: dati };
    },
    pausa: async () => {},
  });
  assert.deepEqual(r, { ok: true, attese: ['x', 'sua', 'mia'] });
  assert.deepEqual(lette, ['v1', 'v2'], 'ricalcolato sulla versione nuova');

  let scritture = 0;
  const sempre = await A.scriviSullaLettura({
    leggi: async () => ({ versione: 'v' }), calcola: async () => ({ scrivi: [] }),
    scrivi: async () => { scritture += 1; return { conflitto: true }; }, pausa: async () => {},
  });
  assert.equal(sempre.ok, false);
  assert.equal(scritture, A.RILETTURE);
  assert.match(sempre.motivo, new RegExp(`cambiate ${A.RILETTURE} volte di seguito mentre le scrivevo: non ho scritto niente`));

  const fine = await A.scriviSullaLettura({ leggi: async () => null, calcola: async () => ({ fine: { ok: false, motivo: 'inesistente' } }), scrivi: async () => assert.fail('non scrive') });
  assert.deepEqual(fine, { ok: false, motivo: 'inesistente' });
  const cieca = await A.scriviSullaLettura({ leggi: async () => ({}), calcola: async () => ({ scrivi: [] }), scrivi: async () => assert.fail('non scrive alla cieca') });
  assert.match(cieca.motivo, /non dice la versione del documento/);
});

test('due pacchetti aperti insieme su due unite aspettate dallo stesso feedback: aspetta tutti e due i pacchetti', async () => {
  const rete = reteFinta({
    ...DOCS, id812: { seq: 812, status: 'todo' }, id815: { seq: 815, status: 'todo' }, id951: { seq: 951 }, id952: { seq: 952 },
    id903: { seq: 903, status: 'todo', waitsFor: [{ id: 'id676', num: '676' }, { id: 'id812', num: '812' }, { id: 'id815', num: '815' }] },
  }, { viva: true });
  try {
    // Il primo pacchetto scrive mentre il secondo ha già letto: la sua prima scrittura trova il documento cambiato.
    const [uno, due] = await Promise.all([
      owner.spostaAttese('id903', ['id812'], { id: 'id951', num: '951' }, { bearer: 'tok' }),
      owner.spostaAttese('id903', ['id815'], { id: 'id952', num: '952' }, { bearer: 'tok' }),
    ]);
    assert.equal(uno.ok, true, uno.motivo);
    assert.equal(due.ok, true, due.motivo);
    const ora = await owner.segnalazioneDaUnire('903', { bearer: 'tok' });
    assert.deepEqual(ora.attese.map((w) => w.num).sort(), ['676', '951', '952'], 'nessuna delle due spostate si perde, e le unite se ne vanno');
    assert.equal(rete.scritte.length, 2);
    assert.equal(rete.rifiutate, 1, 'il secondo aveva letto prima che il primo scrivesse');
  } finally { rete.ripristina(); }
});

test('due --aspetta-anche insieme sullo stesso feedback: restano tutte e due', async () => {
  const docs = { ...DOCS, id1741: { seq: 1741, status: 'todo' }, id1756: { seq: 1756, status: 'todo' }, id1294: { seq: 1294, status: 'todo', waitsFor: [{ id: 'id676', num: '676' }] } };
  const rete = reteFinta(docs, { viva: true });
  try {
    // Un altro agente aggiunge #1741 fra la nostra lettura e la nostra scrittura.
    rete.intanto = (d) => { d.id1294.waitsFor.push({ id: 'id1741', num: '1741' }); d.id1294.v = 2; };
    const r = await owner.segnaAttese('id1294', '1756', { bearer: 'tok', aggiungi: true });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual(docs.id1294.waitsFor.map((w) => w.num), ['676', '1741', '1756']);
    assert.deepEqual(rete.scritte.map((w) => new URL(w.url).searchParams.get('currentDocument.updateTime')), ['v2'], 'la scrittura sulla versione vecchia non è passata');
    assert.match(owner.rispostaAttese('1294', r), /^1294: aspetta #676, #1741, #1756\. Aggiunta l’attesa su #1756\./);
  } finally { rete.ripristina(); }
});

test('--aspetta senza --sostituisci che dopo la rilettura toglierebbe l\'attesa scritta intanto: rifiuta e la nomina', async () => {
  const docs = { ...DOCS, id1741: { seq: 1741, status: 'todo' }, id1756: { seq: 1756, status: 'todo' }, id1294: { seq: 1294, status: 'todo', waitsFor: [{ id: 'id676', num: '676' }] } };
  const rete = reteFinta({ ...docs, id676: { seq: 676, status: 'done' } }, { viva: true });
  try {
    rete.intanto = (d) => { d.id1294.waitsFor.push({ id: 'id1741', num: '1741' }); d.id1294.v = 2; };
    const r = await owner.segnaAttese('id1294', '1756', { bearer: 'tok' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.vive.map((w) => w.num), ['1741']);
    assert.deepEqual(rete.scritte, []);
  } finally { rete.ripristina(); }
});
