// Verifica locale pratica-tutte-parti, giro 1, rilievo 1: server:fondi chiude la pratica quando non trova il ramo
// dell'app, senza che nessuno gli abbia detto «solo server», e quella pratica chiusa fa poi saltare L5 a un ramo
// dell'app qualunque per 48 ore. Firestore e GitHub finti; il server è il checkout gemello di filo-security.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);

async function funzioniDelServer() {
  if (process.env.FILO_SERVER_FUNCTIONS) return process.env.FILO_SERVER_FUNCTIONS;
  const { cartellaDelServer } = await import(pathToFileURL(join(ROOT, 'scripts', 'server-fondi-pratica.mjs')).href);
  const principale = cartellaDelServer(ROOT);
  if (!principale) return '';
  const gemello = join(dirname(principale), '.claude', 'worktrees', basename(ROOT), 'functions');
  return existsSync(join(gemello, 'src', 'localWork.js')) ? gemello : principale;
}

const ID = 'PraticaFintaVerifica1';
const ORA = Date.now();

function firestoreFinto() {
  const docs = new Map();
  const fetchFinto = async (url, init = {}) => {
    const u = new URL(url);
    const m = /\/feedback\/([^/?]+)$/.exec(u.pathname);
    const risposta = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (!m) return risposta(400, { error: `indirizzo inatteso ${url}` });
    const doc = docs.get(decodeURIComponent(m[1]));
    if (!doc) return risposta(404, {});
    if ((init.method || 'GET') === 'GET') return risposta(200, doc);
    const body = JSON.parse(init.body);
    for (const p of u.searchParams.getAll('updateMask.fieldPaths')) {
      const [a, b] = p.split('.');
      if (b) {
        const campi = (doc.fields[a] && doc.fields[a].mapValue && doc.fields[a].mapValue.fields) || {};
        campi[b] = body.fields[a].mapValue.fields[b];
        doc.fields[a] = { mapValue: { fields: campi } };
      } else if (body.fields[a] === undefined) delete doc.fields[a];
      else doc.fields[a] = body.fields[a];
    }
    return risposta(200, doc);
  };
  return { docs, fetchFinto };
}

function praticaLocaleAperta() {
  return {
    name: `projects/finto/databases/(default)/documents/feedback/${ID}`,
    fields: {
      seq: { integerValue: '9999' },
      status: { stringValue: 'working' },
      clientId: { stringValue: 'local:sessione-di-prova' },
      senderProof: { stringValue: 'admin' },
      localOnly: { mapValue: { fields: { by: { stringValue: 'local:sessione-di-prova' }, at: { integerValue: String(ORA - 3600e3) } } } },
      notes: { stringValue: '' },
    },
  };
}

function inChiaro(doc) {
  const v = (x) => (x.stringValue !== undefined ? x.stringValue
    : x.integerValue !== undefined ? Number(x.integerValue)
      : x.mapValue ? Object.fromEntries(Object.entries(x.mapValue.fields || {}).map(([k, y]) => [k, v(y)])) : x.booleanValue);
  return Object.fromEntries(Object.entries(doc.fields).map(([k, x]) => [k, v(x)]));
}

/** server:fondi lanciato come lo lancia l'owner, senza dire che il lavoro sta solo sul server; il ramo dell'app non si trova. */
async function fondiLaParteDelServer(fs) {
  const of = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
  void of;
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  const { FIRESTORE_BASE } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'firestore-auth.mjs')).href);
  const sfp = await import(pathToFileURL(join(ROOT, 'scripts', 'server-fondi-pratica.mjs')).href);
  const righe = [];
  const prima = globalThis.fetch;
  globalThis.fetch = fs.fetchFinto;
  try {
    const k = await sfp.esegui(['claude/parte-del-server', '--feedback', ID], {
      env: {}, log: (s) => righe.push(s), err: (s) => righe.push(s), funzioni: join(ROOT, 'finto-functions'),
      bearer: 'finto', base: FIRESTORE_BASE, lancia: () => 0, ramiAperti: () => [], punta: () => 'a'.repeat(40),
    });
    return { k, righe };
  } finally {
    globalThis.fetch = prima;
  }
}

test('server:fondi, senza sentirsi dire «solo server», lascia aperta la pratica anche se il ramo dell’app non lo trova', async () => {
  const fs = firestoreFinto();
  fs.docs.set(ID, praticaLocaleAperta());
  const { k, righe } = await fondiLaParteDelServer(fs);
  expect(k, righe.join('\n')).toBe(0);
  expect(inChiaro(fs.docs.get(ID)).status, `la parte dell'app può ancora arrivare: ${righe.join(' / ')}`).not.toBe('done');
});

test('la pratica chiusa da un lavoro solo server non fa saltare L5 a un ramo dell’app qualunque', async () => {
  const srv = await funzioniDelServer();
  test.skip(!srv, 'manca il checkout di filo-security accanto al repo');
  const fs = firestoreFinto();
  fs.docs.set(ID, praticaLocaleAperta());
  await fondiLaParteDelServer(fs);
  const pratica = inChiaro(fs.docs.get(ID));
  // Lasciata aperta, la pratica aspetta la sua parte dell'app: lì il caso non nasce.
  test.skip(pratica.status !== 'done', 'server:fondi ha lasciato aperta la pratica');

  const { runOwnerMerge } = require(join(srv, 'src', 'routine', 'ownerMerge.js'));
  const SHA = 'b'.repeat(40);
  const out = await runOwnerMerge({
    admin: true, who: 'owner', branch: 'claude/un-altro-lavoro', sha: SHA, feedbackId: ID,
    github: {
      branchHead: async () => ({ ok: true, sha: SHA }),
      compareDiff: async () => ({ ok: true, diff: '' }),
      mergeSha: async () => ({ ok: true, sha: 'c'.repeat(40) }),
      mergeDryRun: async () => ({ ok: true, status: 'clean' }),
    },
    gates: () => ({ passed: false, trips: [{ gate: 'protected_paths', detail: 'functions/index.js' }] }),
    openApproval: async () => 'richiesta-di-prova',
    readFeedback: async () => pratica,
    recordSkipped: async () => 'traccia', closeLocal: async () => true, noteLocal: async () => true,
  });
  expect(out.result, 'un ramo di un altro lavoro aspetta il sì dell’owner').toBe('blocked');
  expect(out.local && out.local.eligible).toBe(false);
});
