// Verifica locale «lavori locali», giro 8, rilievo 1: un lavoro che tocca app e server tiene la sua pratica in
// qualunque ordine si fondano le due parti. Rete finta, fusione del server finta: nessuna scrittura vera.
import { test, expect } from './../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

function regolaDelServer() {
  let d = ROOT;
  for (let i = 0; i < 6; i++) {
    const f = join(dirname(d), 'filo-security', 'functions', 'src', 'localWork.js');
    if (existsSync(f)) return createRequire(import.meta.url)(f);
    d = dirname(d);
  }
  return null;
}

function pratica(status) {
  return {
    name: 'projects/x/databases/(default)/documents/feedback/loc', fields: {
      clientId: { stringValue: 'local:claude' }, senderProof: { stringValue: 'admin' }, status: { stringValue: status },
      statusPublic: { stringValue: status === 'done' ? 'closed' : 'open' }, seq: { integerValue: '9500' },
      localOnly: { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1' } } } },
    },
  };
}

// La rete finta tiene il documento: lo stato pubblico si scrive in chiaro, e da lì si sa se la pratica è chiusa.
async function serverFondi(status) {
  const doc = pratica(status);
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'PATCH') {
      const f = JSON.parse(init.body || '{}').fields || {};
      if (f.statusPublic) doc.fields.statusPublic = f.statusPublic;
      return new Response('{}', { status: 200 });
    }
    return new Response(JSON.stringify(doc), { status: 200 });
  };
  const W = await imp('scripts/server-fondi-pratica.mjs');
  let fusioni = 0;
  const righe = [];
  try {
    const k = await W.esegui(['claude/prova-server', '--feedback', 'loc'], {
      env: {}, bearer: 'finto', base: 'https://finto/v1', funzioni: 'C:/finto', log: (s) => righe.push(s), err: (s) => righe.push(s),
      lancia: () => { fusioni++; return 0; }, ramiAperti: () => [], punta: () => 'abcdef1234567',
    });
    const chiusa = doc.fields.statusPublic.stringValue === 'closed';
    return { k, fusioni, righe: righe.join('\n'), dopo: { clientId: 'local:claude', senderProof: 'admin', localOnly: { by: 'local:claude', at: 1 }, status: chiusa ? 'done' : 'working' } };
  } finally { globalThis.fetch = vero; }
}

test('server fuso prima di legare il ramo dell’app: la stessa pratica fa ancora saltare L5 alla fusione dell’app', async () => {
  const LW = regolaDelServer();
  test.skip(!LW, 'checkout del server non trovato accanto al repo');
  const s = await serverFondi('todo');
  expect(s.fusioni, s.righe).toBe(1);
  const app = LW.localMergeEligibility(s.dopo);
  expect(app.eligible, `${s.righe}\nalla fusione dell’app: ${app.detail || ''}`).toBe(true);
});
