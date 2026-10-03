// Verifica locale pratica-tutte-parti, giro 1, rilievo 2: la prova a vuoto di server:fondi su una pratica già
// chiusa dalla parte dell'app dice che la pratica «andrebbe in lavorazione», e poi che resterebbe chiusa.

import { test, expect } from '@playwright/test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ID = 'PraticaFintaVerifica2';
const ORA = Date.now();

test('la prova a vuoto su una pratica chiusa dall’app non promette di rimetterla in lavorazione', async () => {
  await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  const { FIRESTORE_BASE } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'firestore-auth.mjs')).href);
  const sfp = await import(pathToFileURL(join(ROOT, 'scripts', 'server-fondi-pratica.mjs')).href);
  const doc = {
    name: `projects/finto/databases/(default)/documents/feedback/${ID}`,
    fields: {
      seq: { integerValue: '9998' },
      status: { stringValue: 'done' },
      clientId: { stringValue: 'local:sessione-di-prova' },
      senderProof: { stringValue: 'admin' },
      localOnly: { mapValue: { fields: { by: { stringValue: 'local:sessione-di-prova' }, at: { integerValue: String(ORA - 7200e3) } } } },
      localMerges: { mapValue: { fields: { app: { integerValue: String(ORA - 3600e3) } } } },
    },
  };
  const scritture = [];
  const prima = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method || 'GET') !== 'GET') scritture.push(url);
    return { ok: true, status: 200, json: async () => doc, text: async () => '' };
  };
  const righe = [];
  try {
    const k = await sfp.esegui(['claude/parte-del-server', '--feedback', ID, '--dry-run'], {
      env: {}, log: (s) => righe.push(s), err: (s) => righe.push(s), funzioni: join(ROOT, 'finto-functions'),
      bearer: 'finto', base: FIRESTORE_BASE, lancia: () => 0, ramiAperti: () => [], punta: () => 'a'.repeat(40),
    });
    expect(k, righe.join('\n')).toBe(0);
  } finally {
    globalThis.fetch = prima;
  }
  expect(scritture, 'la prova a vuoto non scrive').toEqual([]);
  const prova = righe.find((r) => /^PROVA:/.test(r)) || '';
  expect(prova, 'la prova a vuoto dice cosa succederebbe').toMatch(/resterebbe chiusa/);
  expect(prova, 'una pratica chiusa non va in lavorazione').not.toMatch(/andrebbe in lavorazione/);
});
