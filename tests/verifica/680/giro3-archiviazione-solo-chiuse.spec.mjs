// Verifica del lavoro «#680», terzo giro — l'archiviazione automatica chiede al
// database di filtrare, non solo di mandare righe più leggere.
//
// La segnalazione chiedeva due cose per ogni scansione: chiedere solo i campi
// che servono, E far filtrare il database dove può — «i soli risolti per
// l'archiviazione». La prima è fatta: le righe adesso pesano duecento byte
// invece di sei KB. La seconda cambia un'altra cosa, e il server le conta
// entrambe: quante RIGHE consegna. L'archiviazione decide solo su segnalazioni
// chiuse, quindi le aperte sono righe pagate e buttate a ogni giro.
//
// Il database è finto ma onora il filtro come quello vero, qualunque campo gli
// si chieda di guardare: la prova non dice COME filtrare, dice che le
// segnalazioni aperte non devono arrivare — e che il verdetto non cambia.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

const RUNNER = `
import { readFileSync, writeFileSync } from 'node:fs';
const CFG = JSON.parse(readFileSync(process.env.FINTO_CFG, 'utf8'));
const DOCS = CFG.docs;
const stat = { consegnate: [] };
const nome = (coll, id) => \`projects/p/databases/(default)/documents/\${coll}/\${id}\`;
const valore = (v) => (v == null ? null : (v.stringValue ?? v.integerValue ?? v.timestampValue ?? null));
// Il filtro di Firestore: un campo assente non passa nessun confronto, ed è il
// motivo per cui filtrare può far sparire delle righe senza dirlo.
function passa(doc, where) {
  if (!where) return true;
  const ff = where.fieldFilter;
  if (ff) {
    const a = valore(doc.fields[ff.field.fieldPath]);
    if (a === null) return false;
    const b = valore(ff.value);
    if (ff.op === 'EQUAL') return a === b;
    if (ff.op === 'NOT_EQUAL') return a !== b;
    if (ff.op === 'GREATER_THAN') return a > b;
    if (ff.op === 'GREATER_THAN_OR_EQUAL') return a >= b;
    if (ff.op === 'LESS_THAN') return a < b;
    if (ff.op === 'LESS_THAN_OR_EQUAL') return a <= b;
    return true;
  }
  const uf = where.unaryFilter;
  if (uf) {
    const c = doc.fields[uf.field.fieldPath] !== undefined;
    if (uf.op === 'IS_NULL' || uf.op === 'IS_NOT_EXISTS') return !c;
    return c;
  }
  const comp = where.compositeFilter;
  if (comp) {
    const f = (comp.filters || []).map((x) => passa(doc, x));
    return comp.op === 'OR' ? f.some(Boolean) : f.every(Boolean);
  }
  return true;
}
function proietta(doc, campi) {
  if (!campi || !campi.length) return { ...doc.fields };
  const out = {};
  for (const c of campi) if (c !== '__name__' && doc.fields[c] !== undefined) out[c] = doc.fields[c];
  return out;
}
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = typeof opts.body === 'string' && opts.body.startsWith('{') ? JSON.parse(opts.body) : null;
  if (u.includes('securetoken') || u.includes('token?key')) {
    return { ok: true, status: 200, json: async () => ({ id_token: 'tok', access_token: 'tok' }) };
  }
  if (u.includes(':runQuery')) {
    const sq = body.structuredQuery;
    const coll = sq.from[0].collectionId;
    let arr = (DOCS[coll] || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    arr = arr.filter((d) => passa(d, sq.where));
    const rif = sq.startAt && (sq.startAt.values || []).find((v) => v.referenceValue);
    if (rif) { const i = arr.findIndex((d) => nome(coll, d.id) === rif.referenceValue); arr = i >= 0 ? arr.slice(i + 1) : arr; }
    if (sq.limit) arr = arr.slice(0, sq.limit);
    const campi = sq.select ? sq.select.fields.map((f) => f.fieldPath) : null;
    if (coll === 'feedback') for (const d of arr) stat.consegnate.push(d.id);
    return { ok: true, status: 200, json: async () => arr.map((d) => ({ document: { name: nome(coll, d.id), fields: proietta(d, campi) } })) };
  }
  if (opts.method === 'PATCH') return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  return { ok: false, status: 404, text: async () => 'non gestito', json: async () => ({}) };
};
process.on('exit', () => { try { writeFileSync(CFG.stat, JSON.stringify(stat)); } catch (_) {} });
process.argv = [process.argv[0], CFG.target, ...(CFG.argv || [])];
await import(CFG.target);
`;

// Tre chiuse (una da archiviare, una che gli utenti dicono rotta, una che
// l'owner tiene aperta a mano) e quattro aperte. Le aperte non hanno voti: i
// voti si danno alle schede della bacheca, e in bacheca ci va solo il chiuso.
function collezione() {
  const vecchio = new Date(Date.parse('2026-09-20T12:00:00Z') - 5 * 24 * 3600_000).toISOString();
  const voti = (esito) => ({ mapValue: { fields: Object.fromEntries(['a', 'b'].map((k) => [k,
    { mapValue: { fields: { vote: { stringValue: esito }, at: { stringValue: vecchio }, weight: { integerValue: '3' } } } }])) } });
  const chiusa = (id, extra) => ({ id, fields: {
    status: { stringValue: 'done' }, statusPublic: { stringValue: 'closed' },
    resolvedAt: { stringValue: vecchio }, resolvedInVersion: { stringValue: '0.1.0' },
    seq: { integerValue: String(id.charCodeAt(0)) }, subSeq: { integerValue: '0' }, ...extra } });
  const aperta = (id) => ({ id, fields: {
    status: { stringValue: 'todo' }, statusPublic: { stringValue: 'open' },
    seq: { integerValue: String(id.charCodeAt(0)) }, subSeq: { integerValue: '0' } } });
  return {
    feedback: [
      chiusa('c-archiviabile', {}),
      chiusa('d-rotta', {}),
      chiusa('e-tenuta', { archiveOverride: { stringValue: 'keep_open' } }),
      aperta('f-aperta'), aperta('g-aperta'), aperta('h-aperta'), aperta('i-aperta'),
    ],
    'feedback-public': [
      { id: 'c-archiviabile', fields: { votes: voti('works') } },
      { id: 'd-rotta', fields: { votes: voti('broken') } },
      { id: 'e-tenuta', fields: { votes: voti('works') } },
    ],
  };
}

const APERTE = ['f-aperta', 'g-aperta', 'h-aperta', 'i-aperta'];

let BASE = '';
test.beforeAll(() => { BASE = cartellaTemporanea('verifica-680-g3b-'); });

test('l\'archiviazione automatica non si fa consegnare le segnalazioni aperte, e decide la stessa cosa', () => {
  const dir = join(BASE, 'giro');
  mkdirSync(dir, { recursive: true });
  const runner = join(dir, 'runner.mjs');
  writeFileSync(runner, RUNNER, 'utf8');
  const cfg = join(dir, 'cfg.json');
  const stat = join(dir, 'stat.json');
  writeFileSync(cfg, JSON.stringify({
    docs: collezione(), stat, argv: ['--dry-run'],
    target: join(ROOT, 'scripts', 'auto-archive.mjs'),
  }));
  let out = '';
  try {
    out = execFileSync(process.execPath, [runner], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FINTO_CFG: cfg, FILO_ADMIN_REFRESH_TOKEN: 'rt', FILO_COPIE_DIR: dir },
    });
  } catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; }

  // Il verdetto: quello che va archiviato e quello che gli utenti dicono rotto.
  // Filtrare non deve cambiarlo di una virgola.
  expect(out, out).toMatch(/Da archiviare \(1\)/);
  expect(out, out).toMatch(/gli utenti dicono che non va[^(]*\(1[^)]*\): d-rotta/);

  const consegnate = JSON.parse(readFileSync(stat, 'utf8')).consegnate;
  const apertePagate = consegnate.filter((id) => APERTE.includes(id));
  expect(apertePagate,
    `il server ha consegnato ${apertePagate.length} segnalazioni aperte, che l'archiviazione non guarda: `
    + 'sono righe pagate e buttate a ogni giro').toEqual([]);
});
