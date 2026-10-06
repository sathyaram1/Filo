// Gli script dell'owner firmano l'ora dell'ultima modifica su ogni feedback (#676), ma le regole si pubblicano solo
// da main, dopo la fusione: con le regole vecchie una scrittura deve passare senza la firma, come quella dell'app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRIPTS = join(ROOT, 'scripts');
const ID = 'fbRegoleVecchie';

// Regole di produzione prima della pubblicazione: una PATCH che scrive `updatedAt` viene respinta.
async function conRegoleVecchie(fn) {
  const realFetch = globalThis.fetch;
  const patch = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if ((init.method || 'GET') === 'GET') {
      return new Response(JSON.stringify({ name: `x/feedback/${ID}`, fields: { statusPublic: { stringValue: 'open' } } }), { status: 200 });
    }
    patch.push({ url: u, body: JSON.parse(String(init.body || '{}')) });
    if (u.includes('updatedAt')) return new Response('{"error":{"code":403}}', { status: 403 });
    return new Response('{}', { status: 200 });
  };
  try { return await fn(patch); } finally { globalThis.fetch = realFetch; }
}

test('con le regole vecchie la scrittura dello script passa, senza la firma', async () => {
  const of = await import(pathToFileURL(join(SCRIPTS, 'owner-feedback.mjs')).href);
  await conRegoleVecchie(async (patch) => {
    const r = await of.segnaPreapprovazione(ID, false, { bearer: 'finto' });
    assert.equal(r.ok, true, r.motivo);
    assert.equal(patch.length, 2);
    assert.match(patch[0].url, /updateMask\.fieldPaths=updatedAt/);
    assert.ok(patch[0].body.fields.updatedAt);
    assert.doesNotMatch(patch[1].url, /updatedAt/);
    assert.equal('updatedAt' in patch[1].body.fields, false);
    assert.match(patch[1].url, /updateMask\.fieldPaths=mergePreapproved/);
  });
});

test('la riprova tiene il resto della domanda, e non riparte se il rifiuto non riguarda la firma', async () => {
  const { patchFirmato, firmaOra } = await import(pathToFileURL(join(SCRIPTS, 'lib', 'firma-ora.mjs')).href);
  await conRegoleVecchie(async (patch) => {
    const base = 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/feedback/x';
    const res = await patchFirmato(`${base}?updateMask.fieldPaths=localOnly&updateMask.fieldPaths=updatedAt&currentDocument.exists=true`, {
      method: 'PATCH', body: JSON.stringify({ fields: { localOnly: { stringValue: 's' }, updatedAt: firmaOra() } }),
    });
    assert.equal(res.status, 200);
    assert.match(patch[1].url, /\/databases\/\(default\)\/documents\/feedback\/x\?/);
    assert.match(patch[1].url, /currentDocument\.exists=true/);
    assert.match(patch[1].url, /updateMask\.fieldPaths=localOnly/);
  });
  await conRegoleVecchie(async (patch) => {
    globalThis.fetch = async (u, init) => { patch.push({ url: String(u), body: JSON.parse(init.body) }); return new Response('{}', { status: 403 }); };
    const res = await patchFirmato('https://h/feedback/x?updateMask.fieldPaths=status', { method: 'PATCH', body: '{"fields":{"status":{}}}' });
    assert.equal(res.status, 403);
    assert.equal(patch.length, 1);
  });
});

function fileMjs(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : fileMjs(p);
    return n.endsWith('.mjs') ? [p] : [];
  });
}

test('ogni PATCH di uno script su un feedback passa da patchFirmato', () => {
  const fuori = [];
  for (const f of fileMjs(SCRIPTS)) {
    const righe = readFileSync(f, 'utf8').split('\n');
    righe.forEach((r, i) => {
      if (/\bfetch\(`\$\{FIRESTORE_BASE\}\/feedback\//.test(r) && /method:\s*'PATCH'/.test(righe.slice(i, i + 3).join('\n'))) {
        fuori.push(`${relative(ROOT, f)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(fuori, []);
});
