// Verifica locale della routine server, giro 3: lavoro server e lavoro normale seguono lo stesso ordine della coda,
// al pacemaker e al biglietto successivo di una sessione già viva. Server nel worktree gemello (FILO_SERVER_DIR).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function cartellaServer() {
  if (process.env.FILO_SERVER_DIR) return process.env.FILO_SERVER_DIR;
  const m = ROOT.replace(/\\/g, '/').match(/^(.*)\/Filo\/\.claude\/worktrees\/([^/]+)$/);
  const candidati = m ? [`${m[1]}/filo-security/.claude/worktrees/${m[2]}`, `${m[1]}/filo-security`] : [];
  candidati.push(path.resolve(ROOT, '..', 'filo-security'));
  return candidati.find((c) => existsSync(path.join(c, 'functions', 'src', 'routine', 'pacemaker.js'))) || '';
}

const SRV = cartellaServer();
const F = SRV ? path.join(SRV, 'functions') : '';
const TRIG = { A: 'trig_AAAAAAAAAAAAAAAAAAAAAAAA', B: 'trig_BBBBBBBBBBBBBBBBBBBBBBBB', S: 'trig_SSSSSSSSSSSSSSSSSSSSSSSS' };
const NOW = Date.parse('2026-10-17T12:00:00Z');

function pulisci() {
  expect(F, 'il worktree di filo-security non si trova: imposta FILO_SERVER_DIR').not.toBe('');
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.normalize(F))) delete require.cache[k];
}

function finto(cfgDoc) {
  const fdb = {
    doc: (p) => ({ get: async () => ({ exists: p === 'config/routines', data: () => (p === 'config/routines' ? cfgDoc : {}) }) }),
    collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) }),
  };
  require(path.join(F, 'src/data/firestore.js')).db = () => fdb;
}

function scenario({ maxSessions = 1, proberWhenIdle = true, items = [], keys }) {
  pulisci();
  finto({
    enabled: true, proberWhenIdle, maxSessions, lavoriServer: true,
    routineId: TRIG.A, routineIdB: TRIG.B, routineIdServer: TRIG.S, pacemakerDailyCap: 12,
  });
  const store = require(path.join(F, 'src/routine/store.js'));
  const queue = require(path.join(F, 'src/routine/queue.js'));
  const pace = { lastSweepMs: NOW + 10 * 3600e3 };
  const merge = (a, b) => {
    for (const [k, v] of Object.entries(b)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') merge(a[k], v); else a[k] = v;
    }
    return a;
  };
  store.readPacemaker = async () => JSON.parse(JSON.stringify(pace));
  store.patchPacemaker = async (p) => { merge(pace, JSON.parse(JSON.stringify(p))); };
  store.liveLeases = async () => ({ working: 0, feedbackIds: new Set() });
  store.liveLeaseFeedbackIds = async () => new Set();
  store.listKeys = async () => keys;
  store.readStates = async () => new Map();
  queue.readOpenFeedbacks = async () => ({ items, unreadable: 0 });
  require(path.join(F, 'src/routine/waits.js')).readWaited = async () => new Map();
  require(path.join(F, 'src/routine/gitToken.js')).revocaOrfani = async () => ({ revocati: 0, controllati: 0, fallite: [] });
  require(path.join(F, 'src/routine/crediti.js')).fermiPerCrediti = () => ({ stato: 'ok', fermi: {}, dettaglio: {} });
  require(path.join(F, 'src/routine/channel.js')).fiduciaPerBiglietto = async (work, its) =>
    ({ fiducia: 'fidato', motivi: [], feedback: its.find((x) => x._id === work.id) });
  process.env.CC_ROUTINE_FIRE_TOKEN = 'tA';
  process.env.CC_ROUTINE_FIRE_TOKEN_B = 'tB';
  process.env.CC_ROUTINE_FIRE_TOKEN_SERVER = 'tS';
  const pm = require(path.join(F, 'src/routine/pacemaker.js'));
  const accese = [];
  const fetchImpl = async (url) => { accese.push(String(url).match(/routines\/([^/]+)\/fire/)[1]); return { ok: true, status: 200 }; };
  const giro = async () => {
    Object.assign(pace, { pendingFires: [], lastBeatMs: NOW - 1800e3, lastReleaseMs: NOW - 1800e3, lastProbeMs: NOW - 1700e3, serverLastProbeMs: NOW - 1700e3 });
    await pm.runPacemaker({ nowMs: NOW, fetchImpl });
    return accese;
  };
  return { giro };
}

const CHIAVI = [
  { slug: 'routine-a', scope: 'routine', rete: 'limitata', lavori: 'normali', account: 'A' },
  { slug: 'routine-srv', scope: 'routine', rete: 'limitata', lavori: 'server', account: 'B' },
];
const lavoroServer = (id, priority) => ({
  _id: id, status: 'todo', seq: 900, subSeq: 0, priority, fiducia: 'fidato',
  createdAt: '2026-10-01T00:00:00Z', localOnly: { by: 'owner', at: '2026-10-01' },
});
const lavoroNormale = (id, priority) => ({ _id: id, status: 'todo', seq: 901, subSeq: 0, priority, fiducia: 'fidato', createdAt: '2026-10-02T00:00:00Z' });
const inVerifica = (fb) => Object.assign(fb, { status: 'revision_capability', branch: `claude/${fb._id.toLowerCase()}` });

test('r1 con una sessione, la verifica in corso di un lavoro server di priorità 0 passa davanti a un lavoro normale nuovo di priorità 2, come nella coda di A e B', async () => {
  const s = scenario({ proberWhenIdle: false, items: [inVerifica(lavoroServer('S1', 0)), lavoroNormale('N1', 2)], keys: CHIAVI });
  const accese = await s.giro();
  expect(accese).toEqual([TRIG.S]);
});

test('r1 con una sessione, un lavoro server nuovo di priorità 2 non passa davanti alla verifica in corso di un lavoro normale di priorità 0', async () => {
  const s = scenario({ proberWhenIdle: false, items: [lavoroServer('S1', 2), inVerifica(lavoroNormale('N1', 0))], keys: CHIAVI });
  const accese = await s.giro();
  expect(accese).not.toContain(TRIG.S);
  expect(accese).toHaveLength(1);
});

// Il biglietto successivo di una sessione A già viva (l'orchestratore ne chiede uno a ogni worker finito).
async function bigliettoSuccessivo({ items, proberWhenIdle = true }) {
  pulisci();
  finto({ enabled: true, proberWhenIdle, maxSessions: 1, lavoriServer: true, cap3: 6, cap2: 4, cap1: 1, cap0: 0 });
  const store = require(path.join(F, 'src/routine/store.js'));
  const queue = require(path.join(F, 'src/routine/queue.js'));
  const crediti = require(path.join(F, 'src/routine/crediti.js'));
  const chiave = { slug: 'routine-a', data: { scope: 'routine', rete: 'limitata', lavori: 'normali', account: 'A' } };
  const noop = async () => {};
  Object.assign(store, {
    findKeyByFingerprint: async () => chiave,
    touchSystemBeat: noop, patchPacemaker: noop, checkSlugRate: async () => true,
    readPacemaker: async () => ({}),
    liveLeases: async () => ({ working: 0, feedbackIds: new Set() }),
    readStates: async () => new Map(), readState: async () => null, readRamo: async () => null,
    acquireLease: async () => ({ ok: true }), releaseLease: noop, createTicket: noop, touchKey: noop,
    recordWorkerSpawn: noop, registraSulRamo: noop, recordRejection: noop,
  });
  Object.assign(crediti, {
    depositaMisure: noop, leggiCrediti: async () => ({}), fermiPerCrediti: () => ({ stato: 'ok', fermi: {}, dettaglio: {} }),
  });
  queue.readOpenFeedbacks = async () => ({ items, unreadable: 0 });
  queue.resolveGenerations = async () => new Map();
  require(path.join(F, 'src/routine/waits.js')).readWaited = async () => new Map();
  const channel = require(path.join(F, 'src/routine/channel.js'));
  return channel.issueTicket({ passphrase: 'parola-di-a', nowMs: NOW });
}

test('r1 una sessione A già viva, finito il suo lavoro, non prende un\'esplorazione mentre un lavoro server di priorità 3 aspetta il posto', async () => {
  const r = await bigliettoSuccessivo({ items: [lavoroServer('S1', 3)] });
  expect(r.ok).toBe(true);
  expect({ work: r.work, role: r.role }).toEqual({ work: false, role: undefined });
});

test('r1 una sessione A già viva non prende un lavoro normale di priorità 0 mentre un lavoro server di priorità 3 aspetta il posto', async () => {
  const r = await bigliettoSuccessivo({ items: [lavoroServer('S1', 3), lavoroNormale('N1', 0)], proberWhenIdle: false });
  expect(r.ok).toBe(true);
  expect({ work: r.work, role: r.role }).toEqual({ work: false, role: undefined });
});
