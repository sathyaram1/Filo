// Verifica locale, giro 1, rilievo 1: il tetto ai tentativi della fusione chiesta dal server.
// Gira il codice vero del server (recupero, cancello, canale) dal worktree omonimo di filo-security; finti solo
// GitHub e il deposito. FILO_SECURITY_REPO lo sposta altrove.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const inWorktree = basename(dirname(ROOT)) === 'worktrees';
const SERVER = process.env.FILO_SECURITY_REPO
  || (inWorktree ? resolve(ROOT, '..', '..', '..', '..', 'filo-security', '.claude', 'worktrees', basename(ROOT)) : resolve(ROOT, '..', 'filo-security'));
const R = resolve(SERVER, 'functions', 'src', 'routine');
const require = createRequire(import.meta.url);

const MIN = 60 * 1000;
const T0 = Date.parse('2026-10-06T10:00:00Z');
const sha = (c) => String(c).repeat(40).slice(0, 40);

test('r1 tre fusioni chieste dal server e rimandate di fila perché il ramo si era mosso portano la pratica all\'owner', async () => {
  expect(existsSync(resolve(R, 'stall.js')), `server non trovato in ${SERVER}`).toBe(true);
  const stall = require(resolve(R, 'stall.js'));
  const store = require(resolve(R, 'store.js'));
  const deliver = require(resolve(R, 'deliver.js'));
  const github = require(resolve(R, 'github.js'));

  let punta = sha('a');
  const stato = { fb1: { verifierVerdict: 'pass', verifiedSha: punta, secauditDone: true, secauditVerdict: 'pass', secauditSha: punta, secauditAt: new Date(T0).toISOString(), branch: 'worker/1' } };
  const doc = { _id: 'fb1', status: 'revision_security', branch: 'worker/1', seq: 9 };
  const richieste = [];

  store.liveLeaseFeedbackIds = async () => new Set();
  store.readStates = async (ids) => new Map(ids.map((i) => [i, stato[i] ? { ...stato[i] } : null]));
  store.readState = async (i) => (stato[i] ? { ...stato[i] } : null);
  store.writeState = async (i, p) => { stato[i] = { ...(stato[i] || {}), ...p }; };
  store.clearState = async (i) => { delete stato[i]; };
  store.recordProvaFusione = async () => {};
  store.listApprovals = async () => [];
  store.recordRejection = () => {};
  deliver.readFeedbackDoc = async () => ({ ...doc });
  deliver.applyStatus = async (_i, _d, to) => { doc.status = to; return { ok: true }; };
  deliver.resetRoundState = async () => {};
  deliver.recordStall = async () => {};
  deliver.routeRealignment = async () => {};
  // Le due copie del ramo divergono: a ogni richiesta del server la punta su GitHub non è più quella approvata.
  github.branchHead = async () => { richieste.push(punta); punta = sha(String.fromCharCode(98 + richieste.length)); return { ok: true, sha: punta }; };
  github.isAncestor = async () => ({ ok: true, ancestor: true });
  github.compareDiff = async () => ({ ok: true, diff: 'diff --git a/src/x.js b/src/x.js\n+1\n' });
  github.mergeSha = async () => ({ ok: true, status: 'merged', sha: sha('f') });
  github.mergeDryRun = async () => ({ ok: true, status: 'clean' });

  let t = 0;
  for (let giro = 0; giro < 6 && doc.status === 'revision_security'; giro++) {
    t += 61;
    await stall.sweepStalled([{ ...doc }], { nowMs: T0 + t * MIN, fetchImpl: async () => { throw new Error('rete finta'); } });
    if (doc.status !== 'revision_security') break;
    // La routine rifà verifica e sicurezza sulla punta nuova; la sessione di sicurezza muore di nuovo prima del cancello.
    t += 30;
    Object.assign(stato.fb1, { verifierVerdict: 'pass', verifiedSha: punta, secauditDone: true, secauditVerdict: 'pass', secauditSha: punta, secauditAt: new Date(T0 + t * MIN).toISOString() });
  }

  expect(richieste.length, 'fusioni chieste dal server prima di fermarsi').toBeLessThanOrEqual(3);
  expect(doc.status).toBe('design');
});
