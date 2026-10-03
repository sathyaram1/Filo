// Verifica locale «pratica di tutte le parti» (#915), giro 3, rilievo 2: con un ramo dell'app legato alla pratica e
// fuori da main, server:fondi non deve consigliare --solo-server, che poi rifiuterebbe. Firestore finto. Non apre Filo.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const ID = 'praticaFinta915b';

test('server:fondi con un ramo dell\'app legato non consiglia il comando che poi rifiuta', async () => {
  const { esegui } = await imp('scripts/server-fondi-pratica.mjs');
  const { FIRESTORE_BASE } = await imp('scripts/lib/firestore-auth.mjs');
  await imp('scripts/owner-feedback.mjs');
  const cifra = globalThis.SN_FEEDBACK_CRYPTO;
  const acceso = cifra.isEnabled;
  cifra.isEnabled = () => false;
  const doc = {
    name: `projects/x/databases/(default)/documents/feedback/${ID}`,
    fields: {
      seq: { integerValue: '915' }, status: { stringValue: 'working' }, statusPublic: { stringValue: 'open' },
      clientId: { stringValue: 'local:sessione' }, senderProof: { stringValue: 'admin' }, notes: { stringValue: '' },
      localOnly: { mapValue: { fields: { by: { stringValue: 'owner' }, at: { integerValue: String(Date.now()) } } } },
    },
  };
  const vero = globalThis.fetch;
  const risp = (s, o) => ({ ok: s < 300, status: s, json: async () => o, text: async () => JSON.stringify(o) });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith(':runQuery')) return risp(200, [{ document: { name: doc.name, fields: { subSeq: { integerValue: '0' } } } }]);
    if (!init.method || init.method === 'GET') return risp(200, JSON.parse(JSON.stringify(doc)));
    const body = JSON.parse(init.body);
    for (const p of new URL(u).searchParams.getAll('updateMask.fieldPaths')) {
      const [a, b] = p.split('.');
      if (!b) { if (a in body.fields) doc.fields[a] = body.fields[a]; continue; }
      ((doc.fields[a] ||= { mapValue: { fields: {} } }).mapValue.fields ||= {})[b] = body.fields[a].mapValue.fields[b];
    }
    return risp(200, doc);
  };
  const deps = (righe) => ({
    env: {}, log: (s) => righe.push(String(s)), err: (s) => righe.push(String(s)), bearer: 'b', base: FIRESTORE_BASE,
    funzioni: 'C:/finto/functions', lancia: () => 0, ramiAperti: () => ['claude/app-legato'], punta: () => 'abcdef0123456789',
  });
  const prima = [];
  const dopo = [];
  try {
    await esegui(['claude/srv', '--feedback', '915'], deps(prima));
    const consigliato = prima.join('\n').match(/npm run server:fondi -- \S+ --feedback \d+ --solo-server/);
    if (consigliato) {
      const k = await esegui(['claude/srv', '--feedback', '915', '--solo-server'], deps(dopo));
      expect(k, `consigliato «${consigliato[0]}», poi rifiutato:\n${dopo.join('\n')}`).toBe(0);
    }
  } finally {
    globalThis.fetch = vero;
    cifra.isEnabled = acceso;
  }
});
