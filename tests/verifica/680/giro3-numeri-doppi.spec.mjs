// Verifica del lavoro «#680», terzo giro — il riuso della prova a secco non
// deve poter dare a due segnalazioni lo stesso numero.
//
// La prova a secco mette da parte quello che ha letto e l'applicazione lo
// riusa: è quello che la segnalazione chiedeva (punto 2). Ma i numeri si
// assegnano CONTANDO quelli che ci sono, quindi se fra le due cose è arrivata
// una segnalazione nuova — che il numero se lo prende da sé — il primo numero
// che l'applicazione sta per dare è già preso. Il comando se ne accorge
// confrontando l'elenco riusato con «quante sono adesso», ma quella domanda al
// server può non ricevere risposta: allora il confronto non si fa e il riuso
// passa liscio.
//
// Qui il database è finto (nel contenitore non ci sono credenziali) ma tiene
// davvero i numeri che il comando scrive: quello che si guarda alla fine è lo
// stato delle segnalazioni, non quante letture sono state fatte. Due
// segnalazioni con lo stesso numero non si aggiustano da sole.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

// Il finto database: sta su un file, così due lanci di fila vedono lo stesso
// stato e le scritture del primo arrivano al secondo.
const RUNNER = `
import { readFileSync, writeFileSync } from 'node:fs';
const CFG = JSON.parse(readFileSync(process.env.FINTO_CFG, 'utf8'));
const DB = CFG.db;
const leggiDb = () => JSON.parse(readFileSync(DB, 'utf8'));
const scriviDb = (d) => writeFileSync(DB, JSON.stringify(d));
const nome = (id) => \`projects/p/databases/(default)/documents/feedback/\${id}\`;
const stat = { lette: 0 };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = typeof opts.body === 'string' && opts.body.startsWith('{') ? JSON.parse(opts.body) : null;
  if (u.includes('securetoken') || u.includes('token?key')) {
    return { ok: true, status: 200, json: async () => ({ id_token: 'tok', access_token: 'tok' }) };
  }
  // «Quante sono?»: il server può non saperlo rispondere, e allora il comando
  // non ha con cosa confrontare l'elenco che sta riusando.
  if (u.includes(':runAggregationQuery')) {
    if (CFG.senzaConteggio) return { ok: false, status: 400, text: async () => 'niente conteggio' };
    const sq = body.structuredAggregationQuery.structuredQuery;
    const ff = sq.where && sq.where.fieldFilter;
    const arr = leggiDb().filter((d) => !ff || Number(d.seq || 0) >= Number(ff.value.integerValue));
    return { ok: true, status: 200, json: async () => ([{ result: { aggregateFields: { quanti: { integerValue: String(arr.length) } } } }]) };
  }
  if (u.includes(':runQuery')) {
    const sq = body.structuredQuery;
    let arr = leggiDb().slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const rif = sq.startAt && (sq.startAt.values || []).find((v) => v.referenceValue);
    if (rif) { const i = arr.findIndex((d) => nome(d.id) === rif.referenceValue); arr = i >= 0 ? arr.slice(i + 1) : arr; }
    if (sq.limit) arr = arr.slice(0, sq.limit);
    stat.lette += arr.length;
    const tutti = (d) => {
      const f = { name: { stringValue: d.titolo }, createdAt: { timestampValue: d.createdAt } };
      if (d.seq) { f.seq = { integerValue: String(d.seq) }; f.subSeq = { integerValue: '0' }; }
      return f;
    };
    return { ok: true, status: 200, json: async () => arr.map((d) => ({ document: { name: nome(d.id), fields: tutti(d) } })) };
  }
  // La scrittura del numero: il finto la TIENE, o non si potrebbe guardare come
  // sono finite le segnalazioni.
  const p = u.match(/documents\\/feedback\\/([^?]+)\\?/);
  if (p && opts.method === 'PATCH') {
    const id = decodeURIComponent(p[1]);
    const seq = Number(body.fields.seq.integerValue);
    const d = leggiDb();
    const r = d.find((x) => x.id === id);
    if (r) { r.seq = seq; scriviDb(d); }
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  }
  if (opts.method === 'PATCH') return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  return { ok: false, status: 404, text: async () => 'non gestito', json: async () => ({}) };
};
process.on('exit', () => { try { writeFileSync(CFG.stat, JSON.stringify(stat)); } catch (_) {} });
process.argv = [process.argv[0], CFG.target, ...(CFG.argv || [])];
await import(CFG.target);
`;

let BASE = '';
let RUNNER_PATH = '';
test.beforeAll(() => {
  BASE = cartellaTemporanea('verifica-680-g3-');
  RUNNER_PATH = join(BASE, 'runner.mjs');
  writeFileSync(RUNNER_PATH, RUNNER, 'utf8');
});

// Tre segnalazioni già numerate e due senza numero.
function partenza() {
  return [
    { id: 'a', titolo: 'prima', createdAt: '2026-01-01T10:00:00Z', seq: 1 },
    { id: 'b', titolo: 'seconda', createdAt: '2026-02-01T10:00:00Z', seq: 2 },
    { id: 'c', titolo: 'terza', createdAt: '2026-03-01T10:00:00Z', seq: 3 },
    { id: 'd', titolo: 'senza numero', createdAt: '2026-04-01T10:00:00Z' },
    { id: 'e', titolo: 'senza numero anche lei', createdAt: '2026-05-01T10:00:00Z' },
  ];
}

let n = 0;
function lancia({ dbFile, copie, argv, senzaConteggio }) {
  n += 1;
  const dir = join(BASE, `run-${n}`);
  mkdirSync(dir, { recursive: true });
  const cfg = join(dir, 'cfg.json');
  const stat = join(dir, 'stat.json');
  writeFileSync(cfg, JSON.stringify({
    db: dbFile, stat, senzaConteggio: !!senzaConteggio, argv,
    target: join(ROOT, 'scripts', 'backfill-feedback-numbers.mjs'),
  }));
  let out = '';
  try {
    out = execFileSync(process.execPath, [RUNNER_PATH], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FINTO_CFG: cfg, FILO_ADMIN_REFRESH_TOKEN: 'rt', FILO_COPIE_DIR: copie },
    });
  } catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; }
  return { out, db: JSON.parse(readFileSync(dbFile, 'utf8')) };
}

// La scena: prova a secco, arriva una segnalazione nuova che si prende da sé il
// primo numero libero, applicazione entro la finestra del riuso.
function scena({ senzaConteggio }) {
  const dir = join(BASE, `scena-${senzaConteggio ? 'senza' : 'con'}-conteggio`);
  mkdirSync(dir, { recursive: true });
  const dbFile = join(dir, 'db.json');
  const copie = join(dir, 'copie');
  mkdirSync(copie, { recursive: true });
  writeFileSync(dbFile, JSON.stringify(partenza()));

  lancia({ dbFile, copie, argv: ['--dry-run'], senzaConteggio });

  const db = JSON.parse(readFileSync(dbFile, 'utf8'));
  db.push({ id: 'z', titolo: 'arrivata adesso', createdAt: '2026-09-25T10:00:00Z', seq: 4 });
  writeFileSync(dbFile, JSON.stringify(db));

  return lancia({ dbFile, copie, argv: [], senzaConteggio });
}

function numeriDoppi(db) {
  const visti = new Map();
  const doppi = [];
  for (const d of db) {
    if (!d.seq) continue;
    if (visti.has(d.seq)) doppi.push(`#${d.seq}: ${visti.get(d.seq)} e ${d.id}`);
    else visti.set(d.seq, d.id);
  }
  return doppi;
}

test('col conteggio disponibile il riuso si rifiuta da sé: nessun numero doppio', () => {
  const r = scena({ senzaConteggio: false });
  expect(numeriDoppi(r.db), r.out).toEqual([]);
  // E tutte hanno un numero: rifiutare il riuso non deve lasciarne indietro.
  expect(r.db.filter((d) => !d.seq)).toEqual([]);
});

test('anche quando il server non sa dire quante sono, nessuna segnalazione prende un numero già preso', () => {
  const r = scena({ senzaConteggio: true });
  expect(numeriDoppi(r.db), r.out).toEqual([]);
  expect(r.db.filter((d) => !d.seq)).toEqual([]);
});
