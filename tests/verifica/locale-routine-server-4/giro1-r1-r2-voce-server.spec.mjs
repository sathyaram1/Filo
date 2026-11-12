// Verifica locale della routine server, giro 1: il pacemaker vero di filo-security su un Firestore finto.
// Il server sta nel worktree gemello (FILO_SERVER_DIR per sceglierne un altro); senza, la prova fallisce e lo dice.
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

function scenario({ maxSessions = 1, proberWhenIdle = true, items = [], keys, fermi = {} }) {
  expect(F, 'il worktree di filo-security non si trova: imposta FILO_SERVER_DIR').not.toBe('');
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.normalize(F))) delete require.cache[k];
  const cfgDoc = {
    enabled: true, proberWhenIdle, maxSessions, lavoriServer: true,
    routineId: TRIG.A, routineIdB: TRIG.B, routineIdServer: TRIG.S, pacemakerDailyCap: 12,
  };
  const fdb = {
    doc: (p) => ({ get: async () => ({ exists: p === 'config/routines', data: () => (p === 'config/routines' ? cfgDoc : {}) }) }),
    collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) }),
  };
  require(path.join(F, 'src/data/firestore.js')).db = () => fdb;
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
  require(path.join(F, 'src/routine/crediti.js')).fermiPerCrediti = () => ({ stato: 'ok', fermi, dettaglio: {} });
  require(path.join(F, 'src/routine/channel.js')).fiduciaPerBiglietto = async (work, its) =>
    ({ fiducia: 'fidato', motivi: [], feedback: its.find((x) => x._id === work.id) });
  process.env.CC_ROUTINE_FIRE_TOKEN = 'tA';
  process.env.CC_ROUTINE_FIRE_TOKEN_B = 'tB';
  process.env.CC_ROUTINE_FIRE_TOKEN_SERVER = 'tS';
  const pm = require(path.join(F, 'src/routine/pacemaker.js'));
  const accese = [];
  const fetchImpl = async (url) => { accese.push(String(url).match(/routines\/([^/]+)\/fire/)[1]); return { ok: true, status: 200 }; };
  // Tre giri del pacemaker, ognuno a sessione precedente finita da mezz'ora e già sondata.
  const giri = async (n = 3) => {
    for (let t = 0; t < n; t++) {
      const ora = NOW + t * 3600e3;
      Object.assign(pace, { pendingFires: [], lastBeatMs: ora - 1800e3, lastReleaseMs: ora - 1800e3, lastProbeMs: ora - 1700e3, serverLastProbeMs: ora - 1700e3 });
      await pm.runPacemaker({ nowMs: ora, fetchImpl });
    }
    return accese;
  };
  return { giri, pace };
}

const CHIAVI = [
  { slug: 'routine-a', scope: 'routine', rete: 'limitata', lavori: 'normali', account: 'A' },
  { slug: 'routine-srv', scope: 'routine', rete: 'limitata', lavori: 'server', account: 'B' },
];
const lavoroServer = (id, priority = 3) => ({
  _id: id, status: 'todo', seq: 900, subSeq: 0, priority, fiducia: 'fidato',
  createdAt: '2026-10-01T00:00:00Z', localOnly: { by: 'owner', at: '2026-10-01' },
});
const lavoroNormale = (id, priority = 0) => ({ _id: id, status: 'todo', seq: 901, subSeq: 0, priority, fiducia: 'fidato', createdAt: '2026-10-02T00:00:00Z' });

test('r1 con una sessione e l’esplorazione accesa, un lavoro server fidato accende la routine server', async () => {
  const s = scenario({ items: [lavoroServer('S1')], keys: CHIAVI });
  expect(await s.giri()).toContain(TRIG.S);
});

test('r1 un lavoro server di priorità 3 non resta dietro a uno normale di priorità 0', async () => {
  const s = scenario({ items: [lavoroServer('S1', 3), lavoroNormale('N1', 0)], keys: CHIAVI });
  expect(await s.giri()).toContain(TRIG.S);
});

test('r1 con due sessioni e due lavori normali, il lavoro server di priorità 3 parte', async () => {
  const s = scenario({ maxSessions: 2, items: [lavoroServer('S1', 3), lavoroNormale('N1', 0), Object.assign(lavoroNormale('N2', 0), { seq: 902 })], keys: CHIAVI });
  expect(await s.giri()).toContain(TRIG.S);
});

test('r2 la routine server non si accende se l’account della sua parola d’ordine è nella riserva dei crediti', async () => {
  const chiavi = [CHIAVI[0], Object.assign({}, CHIAVI[1], { account: 'A' })];
  const s = scenario({ maxSessions: 2, proberWhenIdle: false, items: [lavoroServer('S1')], keys: chiavi, fermi: { A: true } });
  expect(await s.giri(1)).not.toContain(TRIG.S);
});
