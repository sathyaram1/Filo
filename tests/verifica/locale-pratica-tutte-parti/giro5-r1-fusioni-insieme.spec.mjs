// Prova del giro 5 (verifica locale) sul lavoro «la pratica si chiude quando tutte le parti sono su main».
// Non apre Filo: server:fondi come lo lancia l'owner, con la pratica in un Firestore finto in memoria.
// Rilievo 1: le due fusioni lanciate insieme lasciano aperta la pratica con tutte e due le parti su main.

import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Firestore REST finto: GET del documento e PATCH con updateMask, sui campi in forma REST. */
function firestoreFinto(id, campi) {
  const doc = { fields: campi };
  const patch = [];
  const leggiPercorso = (fields, p) => p.split('.').reduce((v, k, i, a) => {
    if (!v) return undefined;
    const x = v[k];
    return i < a.length - 1 ? x?.mapValue?.fields : x;
  }, fields);
  const scriviPercorso = (fields, p, val) => {
    const k = p.split('.');
    let f = fields;
    for (let i = 0; i < k.length - 1; i += 1) {
      if (!f[k[i]] || !f[k[i]].mapValue) f[k[i]] = { mapValue: { fields: {} } };
      f[k[i]].mapValue.fields = f[k[i]].mapValue.fields || {};
      f = f[k[i]].mapValue.fields;
    }
    if (val === undefined) delete f[k[k.length - 1]]; else f[k[k.length - 1]] = val;
  };
  const fetchFinto = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (!u.pathname.endsWith(`/feedback/${id}`)) throw new Error(`rete vietata nella prova: ${url}`);
    const risposta = (corpo) => ({ ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) });
    if ((opts.method || 'GET') === 'GET') return risposta({ name: `projects/p/databases/(default)/documents/feedback/${id}`, fields: doc.fields });
    if (opts.method === 'PATCH') {
      const corpo = JSON.parse(opts.body || '{}');
      const mask = u.searchParams.getAll('updateMask.fieldPaths');
      for (const p of mask) scriviPercorso(doc.fields, p, leggiPercorso(corpo.fields || {}, p));
      patch.push({ mask, fields: corpo.fields });
      return risposta({ name: id, fields: doc.fields });
    }
    throw new Error(`metodo inatteso ${opts.method}`);
  };
  return { doc, patch, fetchFinto };
}

test('server:fondi mentre la parte dell’app viene fusa: a fusioni finite, tutte e due le parti su main, la pratica è chiusa', async () => {
  const id = 'pratica915giro5';
  const s = { stringValue: (v) => ({ stringValue: v }) };
  const fs = firestoreFinto(id, {
    seq: { integerValue: '99' }, status: s.stringValue('working'), statusPublic: s.stringValue('open'),
    clientId: s.stringValue('local:sessione'), senderProof: s.stringValue('admin'),
    localOnly: { mapValue: { fields: { by: s.stringValue('owner@prova.it'), at: { integerValue: '1' } } } },
  });
  const fetchVero = globalThis.fetch;
  globalThis.fetch = fs.fetchFinto;
  try {
    const sf = await import(pathToFileURL(resolve(ROOT, 'scripts', 'server-fondi-pratica.mjs')).href);
    globalThis.SN_FEEDBACK_ENC_ENABLED = false;
    let appSuMain = false;
    const out = [];
    const k = await sf.esegui(['claude/x', '--feedback', id], {
      env: {}, bearer: 'prova', base: 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents',
      funzioni: '/server-finto/functions',
      // I test del server durano minuti: intanto l'altra finestra finisce npm run finish -- --feedback N. Il finish ha visto
      // il ramo del server ancora fuori da main, quindi ha fuso l'app e registrato la sua parte lasciando aperta la pratica.
      lancia: () => {
        fs.doc.fields.localMerges = { mapValue: { fields: { app: { integerValue: String(Date.now()) }, ramo: s.stringValue('claude/x') } } };
        appSuMain = true;
        return 0;
      },
      ramiAperti: () => (appSuMain ? [] : ['claude/x']),
      punta: () => 'a'.repeat(40),
      log: (x) => out.push(x), err: (x) => out.push(`ERR ${x}`),
    });
    expect(k, out.join('\n')).toBe(0);
    expect(appSuMain).toBe(true);
    // Tutte e due le parti sono su main e nessun altro comando arriverà a chiuderla: la chiude questo.
    expect(fs.doc.fields.statusPublic.stringValue, out.join('\n')).toBe('closed');
  } finally {
    globalThis.fetch = fetchVero;
  }
});
