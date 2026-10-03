// Verifica locale «pratica di tutte le parti» (#915), giro 3, rilievo 1: una parte già fusa una volta non deve tenere
// per sempre il posto di «su main» quando il suo ramo ha di nuovo lavoro fuori da main. Firestore e GitHub finti,
// server:fondi e la fusione del server veri. Non apre Filo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const H = 3600000;
const ID = 'praticaFinta915';

/** Le functions del server dello stesso lavoro: il worktree omonimo accanto, altrimenti il checkout del server. */
async function functionsDelServer() {
  const ramo = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const nome = ramo.replace(/^claude\//, '');
  for (let d = resolve(ROOT), i = 0; i < 8; i += 1, d = resolve(d, '..')) {
    const w = join(d, '..', 'filo-security', '.claude', 'worktrees', nome, 'functions');
    if (existsSync(join(w, 'src', 'localWork.js'))) return w;
  }
  const { cartellaDelServer } = await imp('scripts/server-fondi-pratica.mjs');
  return cartellaDelServer(ROOT);
}

function pratica({ status, merges }) {
  const mf = {};
  for (const [k, v] of Object.entries(merges)) mf[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v };
  return {
    name: `projects/x/databases/(default)/documents/feedback/${ID}`,
    fields: {
      seq: { integerValue: '915' }, status: { stringValue: status }, statusPublic: { stringValue: 'open' },
      clientId: { stringValue: 'local:sessione' }, senderProof: { stringValue: 'admin' }, notes: { stringValue: '' },
      localOnly: { mapValue: { fields: { by: { stringValue: 'owner' }, at: { integerValue: String(Date.now() - 5 * H) } } } },
      localMerges: { mapValue: { fields: mf } },
    },
  };
}

/** Firestore finto dietro il fetch globale: GET, PATCH con updateMask, runQuery per il numero. */
function firestoreFinto(doc) {
  const vero = globalThis.fetch;
  const risp = (s, o) => ({ ok: s < 300, status: s, json: async () => o, text: async () => JSON.stringify(o) });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith(':runQuery')) return risp(200, [{ document: { name: doc.name, fields: { subSeq: { integerValue: '0' } } } }]);
    const m = u.match(/\/feedback\/([^?]+)(\?(.*))?$/);
    if (!m || decodeURIComponent(m[1]) !== ID) return risp(404, {});
    if (!init.method || init.method === 'GET') return risp(200, JSON.parse(JSON.stringify(doc)));
    const body = JSON.parse(init.body);
    for (const p of new URLSearchParams(m[3] || '').getAll('updateMask.fieldPaths')) {
      const [a, b] = p.split('.');
      if (!b) { if (a in body.fields) doc.fields[a] = body.fields[a]; else delete doc.fields[a]; continue; }
      const dove = ((doc.fields[a] ||= { mapValue: { fields: {} } }).mapValue.fields ||= {});
      const v = body.fields[a]?.mapValue?.fields?.[b];
      if (v) dove[b] = v; else delete dove[b];
    }
    return risp(200, doc);
  };
  return () => { globalThis.fetch = vero; };
}

test('server fuso per primo, poi un seguito sul suo ramo: la fusione dell\'app non chiude la pratica', async () => {
  const fn = await functionsDelServer();
  test.skip(!fn, 'manca il checkout del server');
  const om = createRequire(join(fn, 'index.js'))(join(fn, 'src', 'routine', 'ownerMerge.js'));
  // La pratica dopo server:fondi di claude/c: aperta, parte del server registrata. Poi il ramo del server ha avuto un
  // seguito, e il finish lo vede fuori da main (pendingParts).
  const doc = {
    status: 'working', senderProof: 'admin', clientId: 'local:sessione', localOnly: { by: 'owner', at: Date.now() - 5 * H },
    localMerges: { server: Date.now() - H, ramo: 'claude/c' }, seq: 915,
  };
  let chiusa = false;
  const r = await om.runOwnerMerge({
    admin: true, who: 'owner', branch: 'claude/c', sha: 'a'.repeat(40), feedbackId: ID,
    github: {
      branchHead: async () => ({ ok: true, sha: 'a'.repeat(40) }), compareDiff: async () => ({ ok: true, diff: 'x' }),
      mergeSha: async () => ({ ok: true, sha: 'b'.repeat(40), status: 'merged' }),
    },
    gates: () => ({ passed: true, trips: [] }),
    readFeedback: async () => doc,
    pendingParts: [{ part: 'server', branch: 'claude/c' }],
    closeLocal: async () => { chiusa = true; return true; },
    noteLocal: async () => true,
  });
  expect(r.result).toBe('merged');
  expect(chiusa, 'la pratica si chiude col seguito del server ancora fuori da main').toBe(false);
  expect(r.local && r.local.pending, 'la risposta deve dire che la parte del server manca ancora').toEqual([{ part: 'server', branch: 'claude/c' }]);
});

for (const [titolo, status] of [
  ['app fusa per prima, poi un seguito sul suo ramo', 'working'],
  ['pratica riaperta dall\'owner dopo la fusione dell\'app', 'todo'],
]) {
  test(`${titolo}: server:fondi non chiude la pratica col ramo dell'app legato e fuori da main`, async () => {
    const { esegui } = await imp('scripts/server-fondi-pratica.mjs');
    const { FIRESTORE_BASE } = await imp('scripts/lib/firestore-auth.mjs');
    await imp('scripts/owner-feedback.mjs');
    const cifra = globalThis.SN_FEEDBACK_CRYPTO;
    const acceso = cifra.isEnabled;
    cifra.isEnabled = () => false;
    const doc = pratica({ status, merges: { app: Date.now() - H, ramo: 'claude/d' } });
    const ripristina = firestoreFinto(doc);
    const righe = [];
    try {
      const k = await esegui(['claude/s', '--feedback', '915'], {
        env: {}, log: (s) => righe.push(String(s)), err: (s) => righe.push(String(s)), bearer: 'b', base: FIRESTORE_BASE,
        funzioni: 'C:/finto/functions', lancia: () => 0, ramiAperti: () => ['claude/d'], punta: () => 'abcdef0123456789',
      });
      expect(k).toBe(0);
    } finally {
      ripristina();
      cifra.isEnabled = acceso;
    }
    expect(doc.fields.status.stringValue, righe.join('\n')).not.toBe('done');
  });
}
