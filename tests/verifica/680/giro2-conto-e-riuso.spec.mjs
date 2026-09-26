// Verifica del lavoro «#680», secondo giro — due cose che la segnalazione chiede
// e che il primo giro non aveva messo alla prova: il NUMERO stampato alla fine
// («quanti documenti ho letto») e la LETTURA RIUSATA fra la prova a secco e
// l'applicazione, guardata dal lato dell'applicazione che scrive davvero.
//
// Il database vero qui non c'è: al suo posto risponde un finto Firestore che
// CONTA ogni documento che consegna, da qualunque porta — l'elenco, la query,
// la lettura di un singolo documento. Il conto del finto è la verità; quello
// che lo script stampa deve combaciare.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

// Il finto Firestore. Come quello del primo giro, con due aggiunte: risponde
// anche alla lettura di UN documento (è da lì che passa il passo che archivia) e
// tiene il conto di tutti i documenti consegnati, porta per porta.
const RUNNER = `
import { readFileSync, writeFileSync } from 'node:fs';
const CFG = JSON.parse(readFileSync(process.env.FINTO_CFG, 'utf8'));
const DOCS = CFG.docs;
const stat = { lette: 0, perPorta: {}, patch: [], singoli: [] };
const conta = (n, porta) => { stat.lette += n; stat.perPorta[porta] = (stat.perPorta[porta] || 0) + n; };
const nomeDoc = (coll, id) => \`projects/p/databases/(default)/documents/\${coll}/\${id}\`;
const chiave = (f) => {
  if (!f) return null;
  if (f.integerValue != null) return Number(f.integerValue);
  return f.stringValue != null ? f.stringValue : f.timestampValue;
};
function proietta(doc, campi) {
  if (!campi || !campi.length) return { ...doc.fields };
  const out = {};
  for (const c of campi) if (c !== '__name__' && doc.fields[c] !== undefined) out[c] = doc.fields[c];
  return out;
}
function ordina(arr, orderBy) {
  const ob = (orderBy && orderBy[0]) || { field: { fieldPath: '__name__' }, direction: 'ASCENDING' };
  const campo = ob.field.fieldPath;
  const dir = ob.direction === 'DESCENDING' ? -1 : 1;
  const k = (d) => (campo === '__name__' ? d.id : chiave(d.fields[campo]));
  const vivi = campo === '__name__' ? arr.slice() : arr.filter((d) => d.fields[campo] !== undefined);
  return vivi.sort((a, b) => (k(a) === k(b) ? String(a.id).localeCompare(String(b.id)) * dir : (k(a) > k(b) ? 1 : -1) * dir));
}
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = typeof opts.body === 'string' && opts.body.startsWith('{') ? JSON.parse(opts.body) : null;
  if (u.includes('securetoken') || u.includes('token?key')) {
    return { ok: true, status: 200, json: async () => ({ id_token: 'tok', access_token: 'tok' }) };
  }
  if (u.includes(':runAggregationQuery')) {
    const sq = body.structuredAggregationQuery.structuredQuery;
    let arr = DOCS[sq.from[0].collectionId] || [];
    const ff = sq.where && sq.where.fieldFilter;
    if (ff) arr = arr.filter((d) => {
      const v = d.fields[ff.field.fieldPath];
      return v !== undefined && Number(v.integerValue) >= Number(ff.value.integerValue);
    });
    // Un conteggio costa una lettura ogni mille: qui, sempre una.
    conta(1, 'conteggio');
    return { ok: true, status: 200, json: async () => ([{ result: { aggregateFields: { quanti: { integerValue: String(arr.length) } } } }]) };
  }
  if (u.includes(':runQuery')) {
    const sq = body.structuredQuery;
    const coll = sq.from[0].collectionId;
    let arr = ordina(DOCS[coll] || [], sq.orderBy);
    const rif = sq.startAt && (sq.startAt.values || []).find((v) => v.referenceValue);
    if (rif) {
      const i = arr.findIndex((d) => nomeDoc(coll, d.id) === rif.referenceValue);
      arr = i >= 0 ? arr.slice(i + 1) : arr;
    }
    if (sq.limit) arr = arr.slice(0, sq.limit);
    const campi = sq.select ? sq.select.fields.map((f) => f.fieldPath) : null;
    conta(arr.length, 'query');
    return { ok: true, status: 200, json: async () => arr.map((d) => ({ document: { name: nomeDoc(coll, d.id), fields: proietta(d, campi) } })) };
  }
  // UN documento solo: \`/documents/<coll>/<id>\` (con o senza query string).
  const uno = u.match(/documents\\/([a-z-]+)\\/([^/?]+)(?:\\?(.*))?$/);
  if (uno && (!opts.method || opts.method === 'GET')) {
    const arr = DOCS[uno[1]] || [];
    const d = arr.find((x) => x.id === decodeURIComponent(uno[2]));
    if (!d) return { ok: false, status: 404, text: async () => 'assente', json: async () => ({}) };
    const campi = new URLSearchParams(uno[3] || '').getAll('mask.fieldPaths');
    stat.singoli.push({ url: u.replace(/key=[^&]*/, 'key=X'), maschera: campi });
    conta(1, 'documento singolo');
    return { ok: true, status: 200, json: async () => ({ name: nomeDoc(uno[1], d.id), fields: proietta(d, campi) }) };
  }
  const lista = u.match(/documents\\/([a-z-]+)\\?(.*)$/);
  if (lista && (!opts.method || opts.method === 'GET')) {
    const campi = new URLSearchParams(lista[2]).getAll('mask.fieldPaths');
    const arr = DOCS[lista[1]] || [];
    conta(arr.length, 'elenco');
    return { ok: true, status: 200, json: async () => ({ documents: arr.map((d) => ({ name: nomeDoc(lista[1], d.id), fields: proietta(d, campi) })) }) };
  }
  if (opts.method === 'PATCH') {
    const m = u.match(/documents\\/([a-z-]+)\\/([^/?]+)/);
    const id = m ? decodeURIComponent(m[2]) : '';
    const campi = body && body.fields ? Object.keys(body.fields) : [];
    stat.patch.push({ coll: m ? m[1] : '', id, campi, fields: (body && body.fields) || {} });
    // La scrittura si applica ai dati del finto, così un secondo giro vede
    // quello che il primo ha scritto.
    const arr = DOCS[m ? m[1] : ''] || [];
    const d = arr.find((x) => x.id === id);
    if (d) Object.assign(d.fields, (body && body.fields) || {});
    return { ok: true, status: 200, text: async () => '', json: async () => ({ name: u, fields: (body && body.fields) || {} }) };
  }
  if (opts.method === 'POST' || opts.method === 'DELETE') {
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  }
  return { ok: false, status: 404, text: async () => \`finto: non gestito \${u}\`, json: async () => ({}) };
};
process.on('exit', () => { try { writeFileSync(CFG.stat, JSON.stringify(stat)); } catch (_) {} });
process.argv = [process.argv[0], CFG.target, ...(CFG.argv || [])];
await import(CFG.target);
`;

// Sette segnalazioni, come nel primo giro: due sono archiviabili (chiuse, in
// produzione, votate bene), due non hanno numero. Il testo pesa come pesa
// davvero, così un documento letto per intero si vede.
function collezione() {
  const vecchio = new Date(Date.parse('2026-09-20T12:00:00Z') - 5 * 24 * 3600_000).toISOString();
  const voti = (esito) => ({ mapValue: { fields: Object.fromEntries(['a', 'b'].map((k) => [k,
    { mapValue: { fields: { vote: { stringValue: esito }, at: { stringValue: vecchio }, weight: { integerValue: '3' } } } }])) } });
  const pesante = `FENC${'x'.repeat(4000)}`;
  const fb = (id, extra) => ({ id, fields: {
    name: { stringValue: `titolo ${id}` }, text: { stringValue: pesante }, notes: { stringValue: pesante },
    createdAt: { timestampValue: `2026-0${(id.length % 8) + 1}-01T10:00:00Z` }, ...extra } });
  const chiuso = { status: { stringValue: 'done' }, statusPublic: { stringValue: 'closed' }, resolvedAt: { stringValue: vecchio }, resolvedInVersion: { stringValue: '0.1.0' } };
  return {
    feedback: [
      fb('a-archiviabile', { ...chiuso, seq: { integerValue: '1' }, subSeq: { integerValue: '0' } }),
      fb('b-archiviabile', { ...chiuso, seq: { integerValue: '2' }, subSeq: { integerValue: '0' } }),
      fb('c-tenuto', { ...chiuso, archiveOverride: { stringValue: 'keep_open' }, seq: { integerValue: '3' }, subSeq: { integerValue: '0' } }),
      fb('d-gia-archiviato', { status: { stringValue: 'archived' }, resolvedAt: { stringValue: vecchio }, resolvedInVersion: { stringValue: '0.1.0' }, seq: { integerValue: '4' }, subSeq: { integerValue: '0' } }),
      fb('e-senza-numero', { status: { stringValue: 'review' }, reviewDecision: { stringValue: 'accepted' } }),
      fb('f-senza-numero', { status: { stringValue: 'review' }, reviewDecision: { stringValue: 'accepted' } }),
      fb('g-non-uscito', { status: { stringValue: 'done' }, resolvedAt: { stringValue: vecchio }, resolvedInVersion: { stringValue: '99.0.0' }, seq: { integerValue: '5' }, subSeq: { integerValue: '0' } }),
    ],
    'feedback-public': ['a-archiviabile', 'b-archiviabile', 'c-tenuto', 'g-non-uscito'].map((id, i) => ({
      id, fields: { createdAt: { stringValue: `2026-0${i + 2}-01T10:00:00Z` }, title: { stringValue: 'x' },
        votes: voti('works') } })),
    counters: [{ id: 'feedbackSeq', fields: { value: { integerValue: '5' } } }],
  };
}

let BASE = '';
let RUNNER_PATH = '';
test.beforeAll(() => {
  BASE = cartellaTemporanea('verifica-680-giro2-');
  RUNNER_PATH = join(BASE, 'runner.mjs');
  writeFileSync(RUNNER_PATH, RUNNER, 'utf8');
});

let contatore = 0;
function lancia(script, argv, { copie = null, docs = collezione(), versione = '0.1.0' } = {}) {
  contatore += 1;
  const dir = join(BASE, `giro-${contatore}`);
  mkdirSync(dir, { recursive: true });
  const cfg = join(dir, 'cfg.json');
  const stat = join(dir, 'stat.json');
  writeFileSync(cfg, JSON.stringify({ docs, target: join(ROOT, 'scripts', script), argv, stat }));
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [RUNNER_PATH], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env, FINTO_CFG: cfg, FILO_ADMIN_REFRESH_TOKEN: 'rt',
        FILO_COPIE_DIR: copie || dir, FILO_RELEASED_VERSION: versione,
      },
    });
  } catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; code = e.status; }
  const pulito = out.split('\n').filter((l) => !/^Auth:/.test(l)).join('\n');
  return { out, pulito, code, docs, stat: JSON.parse(readFileSync(stat, 'utf8')) };
}

// Il numero che lo script dichiara alla fine.
function dichiarati(testo) {
  const m = String(testo).match(/Documenti letti dal server in questo giro:\s*(\d+)/);
  return m ? Number(m[1]) : NaN;
}

test('il numero stampato alla fine è QUELLO CHE È COSTATO: anche i documenti riletti per archiviare', () => {
  // La prova a secco: guarda e mette da parte.
  const copie = join(BASE, 'copie-archivio');
  mkdirSync(copie, { recursive: true });
  const secco = lancia('auto-archive.mjs', ['--dry-run'], { copie });
  expect(secco.code, secco.out).toBe(0);
  expect(dichiarati(secco.pulito)).toBeGreaterThanOrEqual(secco.stat.lette);

  // L'applicazione che la segue: riusa la lettura e archivia davvero.
  const applica = lancia('auto-archive.mjs', [], { copie });
  expect(applica.code, applica.out).toBe(0);
  // Che abbia archiviato qualcosa (altrimenti la prova non prova niente).
  expect(applica.stat.patch.filter((p) => p.coll === 'feedback').length).toBeGreaterThan(0);
  expect(applica.pulito).toMatch(/Riuso la lettura della prova a secco/);
  // Il conto dichiarato deve essere quello vero: non zero mentre si rileggono
  // le segnalazioni una per una per archiviarle.
  expect(dichiarati(applica.pulito),
    `dichiarati ${dichiarati(applica.pulito)}, letti davvero ${applica.stat.lette} (${JSON.stringify(applica.stat.perPorta)})`)
    .toBeGreaterThanOrEqual(applica.stat.lette);
});

test('archiviare non rilegge una segnalazione INTERA: dei suoi campi ne servono due', () => {
  const r = lancia('auto-archive.mjs', []);
  expect(r.code, r.out).toBe(0);
  expect(r.stat.singoli.length, 'nessuna rilettura: la prova non sta provando niente').toBeGreaterThan(0);
  // Se una rilettura serve, deve chiedere i campi che guarda (lo stato e il
  // report), non il documento intero col testo cifrato, le note e gli allegati.
  const nude = r.stat.singoli.filter((s) => !s.maschera.length).map((s) => s.url);
  expect(nude, 'il passo che archivia rilegge la segnalazione INTERA').toEqual([]);
});

test('il riordino applicato dopo la prova a secco non regala un numero già preso', () => {
  const copie = join(BASE, 'copie-numeri');
  mkdirSync(copie, { recursive: true });
  const docs = collezione();
  const secco = lancia('backfill-feedback-numbers.mjs', ['--dry-run'], { copie, docs });
  expect(secco.code, secco.out).toBe(0);
  expect(secco.pulito).toMatch(/2 da numerare/);

  // Nel frattempo arriva una segnalazione nuova, che il contatore numera da sé:
  // prende il #6, cioè il primo numero che il riordino stava per assegnare.
  const dopo = collezione();
  dopo.feedback.push({ id: 'h-nuova', fields: {
    name: { stringValue: 'arrivata adesso' }, text: { stringValue: 'x' },
    createdAt: { timestampValue: '2026-09-26T10:00:00Z' },
    seq: { integerValue: '6' }, subSeq: { integerValue: '0' },
    status: { stringValue: 'todo' } } });
  dopo.counters = [{ id: 'feedbackSeq', fields: { value: { integerValue: '6' } } }];

  const applica = lancia('backfill-feedback-numbers.mjs', [], { copie, docs: dopo });
  expect(applica.code, applica.out).toBe(0);
  // I numeri scritti in questo giro.
  const scritti = applica.stat.patch
    .filter((p) => p.coll === 'feedback' && p.fields.seq)
    .map((p) => ({ id: p.id, seq: Number(p.fields.seq.integerValue) }));
  expect(scritti.length, 'non ha numerato niente').toBeGreaterThan(0);
  // Nessuno dei numeri assegnati può essere uno che sul server c'è già.
  const presi = new Set(dopo.feedback
    .filter((d) => d.fields.seq && !scritti.some((s) => s.id === d.id))
    .map((d) => Number(d.fields.seq.integerValue)));
  const collisioni = scritti.filter((s) => presi.has(s.seq));
  expect(collisioni,
    'il riordino ha dato a una segnalazione un numero che ne aveva già un\'altra: '
    + 'ha riusato l\'elenco di qualche minuto prima pur avendo appena chiesto al server quante sono')
    .toEqual([]);
});

// Il controllo che dice DI CHI è la colpa: la stessa scena, rifiutando il riuso.
test('la stessa scena senza riuso della lettura assegna numeri liberi', () => {
  const copie = join(BASE, 'copie-numeri-controllo');
  mkdirSync(copie, { recursive: true });
  lancia('backfill-feedback-numbers.mjs', ['--dry-run'], { copie, docs: collezione() });

  const dopo = collezione();
  dopo.feedback.push({ id: 'h-nuova', fields: {
    name: { stringValue: 'arrivata adesso' }, text: { stringValue: 'x' },
    createdAt: { timestampValue: '2026-09-26T10:00:00Z' },
    seq: { integerValue: '6' }, subSeq: { integerValue: '0' },
    status: { stringValue: 'todo' } } });
  dopo.counters = [{ id: 'feedbackSeq', fields: { value: { integerValue: '6' } } }];

  const r = lancia('backfill-feedback-numbers.mjs', ['--rileggi'], { copie, docs: dopo });
  expect(r.code, r.out).toBe(0);
  const scritti = r.stat.patch
    .filter((p) => p.coll === 'feedback' && p.fields.seq)
    .map((p) => ({ id: p.id, seq: Number(p.fields.seq.integerValue) }));
  const presi = new Set(dopo.feedback
    .filter((d) => d.fields.seq && !scritti.some((s) => s.id === d.id))
    .map((d) => Number(d.fields.seq.integerValue)));
  expect(scritti.filter((s) => presi.has(s.seq))).toEqual([]);
});

test('la prova a secco si paga una volta per OGNI strumento, non solo per uno', () => {
  // La segnalazione lo chiede per tutti: il primo giro l'aveva provato su uno.
  const coppie = [
    ['auto-archive.mjs', ['--dry-run'], []],
    ['backfill-feedback-numbers.mjs', ['--dry-run'], []],
    ['migrate-status.mjs', [], ['--apply']],
    ['migrate-status-padding.mjs', ['--dry-run'], []],
  ];
  for (const [script, secco, applica] of coppie) {
    const copie = join(BASE, `copie-riuso-${script.replace(/\W+/g, '-')}`);
    mkdirSync(copie, { recursive: true });
    const a = lancia(script, secco, { copie });
    expect(a.code, `${script} (prova a secco): ${a.out}`).toBe(0);
    const b = lancia(script, applica, { copie });
    expect(b.code, `${script} (applicazione): ${b.out}`).toBe(0);
    expect(b.pulito, `${script}: l'applicazione non riusa la lettura della prova a secco, o non lo dice`)
      .toMatch(/Riuso la lettura della prova a secco/);
    // E dopo l'applicazione la copia non descrive più il server: si butta.
    const c = lancia(script, applica, { copie });
    expect(c.pulito, `${script}: la copia è rimasta lì dopo un'applicazione`)
      .not.toMatch(/Riuso la lettura della prova a secco/);
  }
});

test('ogni script dichiara il suo conto, e il conto è quello vero, anche a mani vuote', () => {
  const vuota = { feedback: [], 'feedback-public': [], counters: [] };
  for (const [script, argv] of [
    ['auto-archive.mjs', ['--dry-run']],
    ['backfill-feedback-numbers.mjs', ['--dry-run']],
    ['migrate-status.mjs', []],
    ['migrate-status-padding.mjs', ['--dry-run']],
  ]) {
    const r = lancia(script, argv, { docs: vuota });
    expect(r.code, `${script}: ${r.out}`).toBe(0);
    expect(dichiarati(r.pulito), `${script}: dichiarati ${dichiarati(r.pulito)}, letti ${r.stat.lette}`).toBeGreaterThanOrEqual(r.stat.lette);
  }
});
