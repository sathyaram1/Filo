// Verifica locale #915, giro 2, rilievo 1: una pratica già chiusa vale solo per l'ultima parte dello STESSO lavoro,
// non per un ramo qualunque che la cita. Firestore, git e GitHub finti; non apre Filo.
import { test, expect } from '@playwright/test';
import { preparaPratiche, functionsDelServer, richiediServer } from './_pratica-finta.mjs';

const ORA = 3600000;

test('lavoro tutto sul server chiuso a mano: un ramo dell’app che cita la pratica non salta L5', async () => {
  const fn = functionsDelServer();
  test.skip(!fn, 'serve il checkout di filo-security accanto al repo');
  const { nuova, stato, fondi } = await preparaPratiche();
  const of = await import('../../../scripts/owner-feedback.mjs');
  nuova('srv');
  // Il lavoro stava solo sul server, ma chi l'ha fuso non ha scritto --solo-server: la pratica resta aperta.
  const r = await fondi(['claude/solo-server', '--feedback', 'srv']);
  expect(r.k).toBe(0);
  expect(stato('srv').status).toBe('working');
  // E la chiude a mano, con la strada che gli strumenti stessi indicano quando la chiusura non riesce.
  const chiusa = await of.scrivi('srv', 'done', 'Chiusa a mano: il lavoro stava tutto sul server.', { bearer: 'finto', attore: 'routine' });
  expect(chiusa.ok, chiusa.motivo).toBe(true);
  const s = stato('srv');
  const localMerges = Object.fromEntries(Object.entries(s.merges).map(([k, v]) => [k, v.integerValue ? Number(v.integerValue) : v.stringValue]));
  const doc = { status: s.status, clientId: 'owner:prova', senderProof: 'admin', localOnly: { by: 'owner', at: 1 }, seq: 915, localMerges };

  const { runOwnerMerge } = richiediServer(fn)('./src/routine/ownerMerge.js');
  const sha = 'a'.repeat(40);
  const esito = await runOwnerMerge({
    admin: true, who: 'owner', branch: 'claude/un-altro-lavoro', sha, feedbackId: 'srv',
    github: {
      branchHead: async () => ({ ok: true, sha }), compareDiff: async () => ({ ok: true, diff: 'x' }),
      mergeSha: async () => ({ ok: true, sha: 'b'.repeat(40) }), testMerge: async () => ({ ok: true }),
    },
    gates: () => ({ passed: false, trips: [{ gate: 'scope', detail: 'tocca un file protetto' }] }),
    openApproval: async () => 'richiesta', readFeedback: async () => doc, recordSkipped: async () => 'traccia',
    closeLocal: async () => true, noteLocal: async () => true, nowMs: Date.now() + ORA,
  });
  // Un ramo che non è la parte dell'app di quel lavoro aspetta il sì dell'owner come ogni ramo bloccato da L5.
  expect(esito.result).toBe('blocked');
  expect(esito.local && esito.local.eligible).toBe(false);
});

test('pratica chiusa dalla fusione dell’app: un lavoro dichiarato tutto sul server non diventa la sua ultima parte', async () => {
  const { nuova, stato, fondi } = await preparaPratiche();
  nuova('app', { status: 'done', merges: { app: Date.now() - 2 * ORA } });
  const r = await fondi(['claude/lavoro-del-server', '--feedback', 'app', '--solo-server']);
  // «Solo sul server» vuol dire che una parte dell'app non c'è: la pratica chiusa dall'app non è la sua.
  expect(r.k, r.testo).not.toBe(0);
  expect(r.fusioni).toEqual([]);
  expect(stato('app').notes).not.toMatch(/stesso lavoro/);
});
