// Verifica del lavoro «#680», primo giro — la lamentela, rifatta.
//
// Chi ha segnalato lancia gli script di manutenzione contro il database vero e
// si ritrova la collezione intera scaricata per guardarne tre campi. Qui il
// database vero non c'è (nessuna credenziale nel contenitore), quindi al suo
// posto risponde un finto Firestore che si comporta come quello vero su un
// punto solo, ma quello decisivo: ONORA la proiezione, cioè restituisce
// davvero soltanto i campi chiesti.
//
// Ogni script viene lanciato due volte sugli stessi dati: una col finto che
// onora la proiezione, una col finto che la ignora e manda i documenti interi
// (com'era prima). Se ciò che lo script stampa è identico, allora nessun campo
// che serve alla decisione è rimasto fuori dalla richiesta — che è l'unico modo
// in cui questa modifica poteva rompere qualcosa in silenzio.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

// Il finto Firestore: si installa al posto di `fetch` e poi lascia partire lo
// script vero, come se fosse stato lanciato da riga di comando.
const RUNNER = `
import { readFileSync, writeFileSync } from 'node:fs';
const CFG = JSON.parse(readFileSync(process.env.FINTO_CFG, 'utf8'));
const DOCS = CFG.docs;
const HONOR = CFG.honor !== false;
const stat = { lette: 0, richieste: [] };
const nomeDoc = (coll, id) => \`projects/p/databases/(default)/documents/\${coll}/\${id}\`;
const chiave = (f) => {
  if (!f) return null;
  if (f.integerValue != null) return Number(f.integerValue);
  return f.stringValue != null ? f.stringValue : f.timestampValue;
};
function proietta(doc, campi) {
  if (!HONOR || !campi || !campi.length) return { ...doc.fields };
  const out = {};
  for (const c of campi) if (c !== '__name__' && doc.fields[c] !== undefined) out[c] = doc.fields[c];
  return out;
}
function ordina(arr, orderBy) {
  const ob = (orderBy && orderBy[0]) || { field: { fieldPath: '__name__' }, direction: 'ASCENDING' };
  const campo = ob.field.fieldPath;
  const dir = ob.direction === 'DESCENDING' ? -1 : 1;
  const k = (d) => (campo === '__name__' ? d.id : chiave(d.fields[campo]));
  // Firestore lascia fuori da sé i documenti senza il campo d'ordinamento.
  const vivi = campo === '__name__' ? arr.slice() : arr.filter((d) => d.fields[campo] !== undefined);
  return vivi.sort((a, b) => (k(a) === k(b) ? String(a.id).localeCompare(String(b.id)) * dir : (k(a) > k(b) ? 1 : -1) * dir));
}
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = typeof opts.body === 'string' && opts.body.startsWith('{') ? JSON.parse(opts.body) : null;
  stat.richieste.push({ url: u.replace(/key=[^&]*/, 'key=X'), body });
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
    stat.lette += arr.length;
    return { ok: true, status: 200, json: async () => arr.map((d) => ({ document: { name: nomeDoc(coll, d.id), fields: proietta(d, campi) } })) };
  }
  const m = u.match(/documents\\/([a-z-]+)\\?(.*)$/);
  if (m && (!opts.method || opts.method === 'GET')) {
    const campi = new URLSearchParams(m[2]).getAll('mask.fieldPaths');
    const arr = DOCS[m[1]] || [];
    stat.lette += arr.length;
    return { ok: true, status: 200, json: async () => ({ documents: arr.map((d) => ({ name: nomeDoc(m[1], d.id), fields: proietta(d, campi) })) }) };
  }
  if (opts.method === 'PATCH') return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  return { ok: false, status: 404, text: async () => 'finto: non gestito', json: async () => ({}) };
};
process.on('exit', () => { try { writeFileSync(CFG.stat, JSON.stringify(stat)); } catch (_) {} });
process.argv = [process.argv[0], CFG.target, ...(CFG.argv || [])];
await import(CFG.target);
`;

// Sette segnalazioni: una da archiviare, una da segnalare, una che l'owner
// tiene aperta, una già archiviata, due senza numero (una con uno stato
// legacy), una il cui fix non è ancora uscito. Il testo pesa come pesa davvero.
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
      fb('b-rotto', { ...chiuso, seq: { integerValue: '2' }, subSeq: { integerValue: '0' } }),
      fb('c-tenuto', { ...chiuso, archiveOverride: { stringValue: 'keep_open' }, seq: { integerValue: '3' }, subSeq: { integerValue: '0' } }),
      fb('d-gia-archiviato', { status: { stringValue: 'archived' }, resolvedAt: { stringValue: vecchio }, resolvedInVersion: { stringValue: '0.1.0' }, seq: { integerValue: '4' }, subSeq: { integerValue: '0' } }),
      fb('e-senza-numero', { status: { stringValue: 'review' }, reviewDecision: { stringValue: 'accepted' } }),
      fb('f-bloccato', { status: { stringValue: 'blocked' }, blockReason: { stringValue: 'loop' }, clientId: { stringValue: 'owner:x' } }),
      fb('g-non-uscito', { status: { stringValue: 'done' }, resolvedAt: { stringValue: vecchio }, resolvedInVersion: { stringValue: '99.0.0' }, seq: { integerValue: '5' }, subSeq: { integerValue: '0' } }),
    ],
    'feedback-public': ['a-archiviabile', 'b-rotto', 'c-tenuto', 'g-non-uscito'].map((id, i) => ({
      id, fields: { createdAt: { stringValue: `2026-0${i + 2}-01T10:00:00Z` }, title: { stringValue: 'x' },
        votes: voti(id === 'b-rotto' ? 'broken' : 'works') } })),
  };
}

let BASE = '';
let RUNNER_PATH = '';
test.beforeAll(() => {
  BASE = cartellaTemporanea('verifica-680-');
  RUNNER_PATH = join(BASE, 'runner.mjs');
  writeFileSync(RUNNER_PATH, RUNNER, 'utf8');
});

let contatore = 0;
function lancia(script, argv, { honor = true, copie = null, docs = collezione() } = {}) {
  contatore += 1;
  const dir = join(BASE, `giro-${contatore}`);
  mkdirSync(dir, { recursive: true });
  const cfg = join(dir, 'cfg.json');
  const stat = join(dir, 'stat.json');
  writeFileSync(cfg, JSON.stringify({ docs, honor, target: join(ROOT, 'scripts', script), argv, stat }));
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [RUNNER_PATH], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FINTO_CFG: cfg, FILO_ADMIN_REFRESH_TOKEN: 'rt', FILO_COPIE_DIR: copie || dir },
    });
  } catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; code = e.status; }
  // La riga dell'autenticazione cambia da sola: fuori dal confronto.
  const pulito = out.split('\n').filter((l) => !/^Auth:/.test(l)).join('\n');
  return { out, pulito, code, stat: JSON.parse(readFileSync(stat, 'utf8')) };
}

const SECCO = [
  ['auto-archive.mjs', ['--dry-run']],
  ['backfill-feedback-numbers.mjs', ['--dry-run']],
  ['migrate-status.mjs', []],
  ['migrate-status-padding.mjs', ['--dry-run']],
];

for (const [script, argv] of SECCO) {
  test(`${script}: chiedere solo i campi che servono non cambia di una virgola quello che decide`, () => {
    const proiettato = lancia(script, argv, { honor: true });
    const intero = lancia(script, argv, { honor: false });
    expect(proiettato.code, `${script} è uscito male: ${proiettato.out}`).toBe(0);
    expect(proiettato.pulito).toBe(intero.pulito);
    // E il conto del giro finisce a schermo, non in fattura.
    expect(proiettato.pulito).toMatch(/Documenti letti dal server in questo giro: \d+/);
  });
}

test('nessuna scansione chiede più dei campi che guarda', () => {
  const a = lancia('auto-archive.mjs', ['--dry-run']);
  const query = a.stat.richieste.filter((r) => r.body && r.body.structuredQuery);
  const segnalazioni = query.find((r) => r.body.structuredQuery.from[0].collectionId === 'feedback');
  const schede = query.find((r) => r.body.structuredQuery.from[0].collectionId === 'feedback-public');
  const campi = (r) => r.body.structuredQuery.select.fields.map((f) => f.fieldPath);
  expect(campi(segnalazioni).sort()).toEqual(['archiveOverride', 'resolvedAt', 'resolvedInVersion', 'seq', 'status', 'subSeq', 'votes']);
  expect(campi(schede).sort()).toEqual(['reopenRequests', 'votes']);

  const b = lancia('backfill-feedback-numbers.mjs', ['--dry-run']);
  const scansione = b.stat.richieste.find((r) => r.body && r.body.structuredQuery && r.body.structuredQuery.select);
  expect(scansione.body.structuredQuery.select.fields.map((f) => f.fieldPath).sort()).toEqual(['createdAt', 'name', 'seq', 'subSeq']);
  // «Quanti sono?» chiesto al server: una lettura ogni mille, non una a testa.
  expect(b.stat.richieste.filter((r) => r.url.includes(':runAggregationQuery')).length).toBe(2);

  for (const script of ['migrate-status.mjs', 'migrate-status-padding.mjs']) {
    const r = lancia(script, script === 'migrate-status.mjs' ? [] : ['--dry-run']);
    const lista = r.stat.richieste.find((x) => x.url.includes('/documents/feedback?'));
    expect(lista.url, `${script} elenca senza maschera dei campi`).toMatch(/mask\.fieldPaths=/);
  }
});

test('la prova a secco si paga una volta: l\'applicazione che la segue non riscansiona, e lo dice', () => {
  const copie = join(BASE, 'copie-riuso');
  mkdirSync(copie, { recursive: true });
  const secco = lancia('migrate-status.mjs', [], { copie });
  expect(secco.stat.lette).toBe(7);

  const applica = lancia('migrate-status.mjs', ['--apply'], { copie });
  expect(applica.stat.lette, 'l\'applicazione ha ripagato la scansione della prova a secco').toBe(0);
  expect(applica.pulito).toMatch(/Riuso la lettura della prova a secco/);
  expect(applica.pulito).toMatch(/Documenti letti dal server in questo giro: 0/);
  // Stessa decisione della prova a secco, scritta invece che stampata.
  expect(applica.pulito).toMatch(/Migrati: 2/);

  // Applicato: la copia non descrive più il server e va buttata.
  const ancora = lancia('migrate-status.mjs', ['--apply'], { copie });
  expect(ancora.stat.lette, 'dopo un\'applicazione la copia doveva essere buttata').toBe(7);
});

test('il riuso si può rifiutare: con --rileggi si torna al server', () => {
  const copie = join(BASE, 'copie-rileggi');
  mkdirSync(copie, { recursive: true });
  lancia('migrate-status.mjs', [], { copie });
  const r = lancia('migrate-status.mjs', ['--apply', '--rileggi'], { copie });
  expect(r.stat.lette).toBe(7);
  expect(r.pulito).not.toMatch(/Riuso la lettura/);
});

test('niente da fare, niente da scaricare: con tutti i numeri già assegnati il riordino non scansiona', () => {
  const docs = collezione();
  docs.feedback = docs.feedback.map((d, i) => ({ ...d, fields: { ...d.fields, seq: { integerValue: String(i + 1) }, subSeq: { integerValue: '0' } } }));
  const r = lancia('backfill-feedback-numbers.mjs', ['--dry-run'], { docs });
  expect(r.pulito).toMatch(/0 da numerare/);
  expect(r.stat.richieste.filter((x) => x.body && x.body.structuredQuery && x.body.structuredQuery.select).length,
    'la collezione è stata scansionata anche se non c\'era niente da numerare').toBe(0);
});

test('i casi limite non fanno saltare nessuno script: collezione vuota, e documenti senza nessuno dei campi chiesti', () => {
  const vuota = { feedback: [], 'feedback-public': [] };
  const nudi = { feedback: [{ id: 'n1', fields: { text: { stringValue: 'x' } } }, { id: 'n2', fields: {} }], 'feedback-public': [] };
  for (const docs of [vuota, nudi]) {
    for (const [script, argv] of SECCO) {
      const r = lancia(script, argv, { docs });
      expect(r.code, `${script}: ${r.out}`).toBe(0);
      expect(r.pulito).toMatch(/Documenti letti dal server in questo giro: \d+/);
    }
  }
});
