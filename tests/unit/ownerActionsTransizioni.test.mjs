// Le azioni dell'owner (ownerActions) e la tabella degli stati (TRANSITIONS, attore owner) dicono
// la stessa cosa: un clic in Gestione e `npm run feedback` ammettono gli stessi passaggi (#776).
// «✓ Risolto» resta una catena di routine (--come-routine), mai una riga owner → done.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'feedbackStatus.js'));
require(join(ROOT, 'src', 'shared', 'manageReview.js'));
const FS = globalThis.SN_FB_STATUS;
const MR = globalThis.SN_MANAGE_REVIEW;
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);

const SEGNO_LOCALE = { by: 'o@x', at: 1790000000000 };

/** Ogni forma in cui uno stato canonico arriva alle pagine: done rilasciato e no, col segno locale, dell'owner. */
function forme(status) {
  const out = [
    { fb: { status }, opts: {} },
    { fb: { status, localOnly: SEGNO_LOCALE, clientId: 'owner:me', senderProof: 'admin' }, opts: {} },
    { fb: { status, statusReason: 'locale', clientId: 'c-utente' }, opts: {} },
  ];
  if (status === 'done') {
    out.push({ fb: { status, resolvedInVersion: '1.0.0' }, opts: { releasedVersion: '1.0.0' } });
    out.push({ fb: { status, resolvedInVersion: '9.9.9' }, opts: { releasedVersion: '1.0.0' } });
  }
  return out;
}

test('ogni azione dell\'owner è una riga della tabella, in ogni stato canonico', () => {
  for (const status of FS.CANONICAL) {
    for (const { fb, opts } of forme(status)) {
      const azioni = MR.ownerActions(fb, opts);
      const dove = `${JSON.stringify(fb)} (${MR.manageTabFor(fb, opts)})`;
      assert.ok(azioni.length > 0, `nessuna azione su ${dove}`);
      for (const a of azioni) {
        if (a.key === 'resolve') {
          assert.equal(a.to, 'done', dove);
          assert.ok(FS.canReach(status, 'done', 'routine'), `«✓ Risolto» su ${dove}: l'iter delle routine non arriva a done`);
          continue;
        }
        assert.ok(FS.canTransition(status, a.to, 'owner'), `«${a.label}» su ${dove}: ${status} → ${a.to} manca per l'owner`);
      }
    }
  }
});

test('nessuna riga owner che le pagine non offrono, e nessuna owner → done', () => {
  const offerte = new Set();
  for (const status of FS.CANONICAL) {
    for (const { fb, opts } of forme(status)) {
      for (const a of MR.ownerActions(fb, opts)) offerte.add(`${status}→${a.to}`);
    }
  }
  for (const from of FS.CANONICAL) {
    assert.equal(FS.canTransition(from, 'done', 'owner'), false, `${from} → done per l'owner`);
    for (const to of FS.transitionsFrom(from, 'owner')) {
      assert.ok(offerte.has(`${from}→${to}`), `${from} → ${to} è ammessa all'owner ma nessuna pagina la offre`);
    }
  }
});

test('npm run feedback: archivia dalla coda e accoda un non filtrato; l\'iter resta delle routine', () => {
  for (const [from, to] of [['todo', 'archived'], ['working', 'archived'], ['revision_capability', 'archived'],
    ['revision_security', 'archived'], ['unlabeled', 'todo'], ['unlabeled', 'archived'], ['attack', 'archived'], ['spam', 'archived']]) {
    assert.deepEqual(mod.transizioneAmmessa(from, to), { ok: true }, `${from} → ${to}`);
  }
  for (const [from, to] of [['todo', 'working'], ['todo', 'done'], ['working', 'done'], ['unlabeled', 'attack']]) {
    assert.equal(mod.transizioneAmmessa(from, to).ok, false, `${from} → ${to}`);
  }
  assert.equal(mod.transizioneAmmessa('todo', 'done', 'routine').ok, true, 'la chiusura a mano passa ancora da --come-routine');
});

/** fetch finto: le GET rendono `doc`, le PATCH si registrano e rispondono ok. */
async function conRete(doc, fn) {
  const patch = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'PATCH') {
      patch.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => doc, text: async () => '' };
  };
  try { return await fn(patch); } finally { globalThis.fetch = vero; }
}

test('un doppione in coda si archivia con una scrittura sola, senza fingersi routine', async () => {
  for (const status of ['todo', 'working']) {
    const doc = {
      name: 'projects/p/databases/(default)/documents/feedback/d1',
      fields: { clientId: { stringValue: 'c-utente' }, status: { stringValue: status }, statusPublic: { stringValue: 'open' }, notes: { stringValue: '' } },
    };
    await conRete(doc, async (patch) => {
      const r = await mod.scrivi('d1', 'archived', 'doppione del #12', { bearer: 'tok-finto' });
      assert.deepEqual([r.ok, r.from, r.to], [true, status, 'archived'], r.motivo);
      assert.equal(patch.length, 1, status);
      assert.equal(patch[0].body.fields.statusPublic.stringValue, 'closed', status);
    });
  }
});
