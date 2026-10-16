// Aiuto della verifica locale «routine server», giro 1: lancia pacemaker e canale del server su un Firestore finto in
// memoria e stampa in JSON quante volte si accende la routine server. Uso: node aiuti-giro1.mjs <functions> <porta>.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [funzioni, porta] = process.argv.slice(2);
const require = createRequire(join(funzioni, 'index.js'));
let current = null;
const fsMod = require(join(funzioni, 'src', 'data', 'firestore'));
fsMod.db = () => current.database;
const secrets = require(join(funzioni, 'src', 'routine', 'secrets'));
const throttle = require(join(funzioni, 'src', 'routine', 'throttle'));
const channel = require(join(funzioni, 'src', 'routine', 'channel'));
const pm = require(join(funzioni, 'src', 'routine', 'pacemaker'));
// I log del server vanno su stdout: si tengono a parte, il risultato è l'ultima riga.
const logs = [];
console.log = (...a) => { logs.push(a.join(' ')); };
console.info = () => {};
console.warn = () => {};
console.error = () => {};

const NOW = Date.parse('2026-10-16T12:00:00Z');
const MIN = 60000;

function makeDb() {
  const docs = new Map();
  const snapOf = (p) => {
    const data = docs.get(p);
    return { exists: data !== undefined, id: p.split('/').pop(), data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))) };
  };
  const unisci = (a, b) => {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b || {})) {
      const oggetto = (x) => x && typeof x === 'object' && !Array.isArray(x);
      out[k] = oggetto(v) && oggetto(out[k]) ? unisci(out[k], v) : v;
    }
    return out;
  };
  const refOf = (p) => ({
    id: p.split('/').pop(),
    get: async () => snapOf(p),
    set: async (fields, opts) => { const cur = docs.get(p); docs.set(p, opts && opts.merge && cur ? unisci(cur, fields) : { ...fields }); },
    update: async (fields) => { docs.set(p, { ...(docs.get(p) || {}), ...fields }); },
    delete: async () => { docs.delete(p); },
  });
  const colOf = (name) => {
    const tutti = (filtro) => {
      const out = [];
      for (const [p, data] of docs) {
        if (!p.startsWith(`${name}/`) || p.slice(name.length + 1).includes('/')) continue;
        if (filtro && !filtro(data)) continue;
        out.push({ id: p.slice(name.length + 1), exists: true, ref: refOf(p), data: () => ({ ...data }) });
      }
      return { empty: out.length === 0, docs: out, size: out.length, forEach: (f) => out.forEach(f) };
    };
    const query = (filtri) => {
      const q = {
        where: (f, op, v) => query(filtri.concat([[f, op, v]])),
        limit: () => q, orderBy: () => q, startAfter: () => q, select: () => q,
        get: async () => tutti((d) => filtri.every(([f, op, v]) => (op === 'in' ? v.includes(d[f]) : op === '!=' ? d[f] !== v : d[f] === v))),
      };
      return q;
    };
    return Object.assign(query([]), { doc: (id) => refOf(`${name}/${id}`), add: async (d) => { docs.set(`${name}/${Math.random()}`, d); } });
  };
  const database = {
    doc: (p) => refOf(p),
    collection: (name) => colOf(name),
    runTransaction: async (fn) => fn({
      get: (ref) => ref.get(),
      set: (ref, fields, opts) => { ref.set(fields, opts); },
      update: (ref, fields) => { ref.update(fields); },
      delete: (ref) => { ref.delete(); },
    }),
    getAll: async (...args) => Promise.all(args.filter((r) => r && typeof r.get === 'function').map((r) => r.get())),
  };
  return { database, docs };
}

Object.assign(process.env, { CC_ROUTINE_FIRE_TOKEN: 'tA', CC_ROUTINE_FIRE_TOKEN_B: 'tB', CC_ROUTINE_FIRE_TOKEN_SERVER: 'tS' });

function preparaCoda() {
  current = makeDb();
  throttle.reset();
  current.docs.set('routine-keys/server', {
    fp: secrets.fingerprint('pw-server'), scope: 'routine', revoked: false, ticketStamps: [], deliveryStamps: [],
    rete: 'limitata', lavori: 'server', account: 'B',
  });
  current.docs.set('config/routines', {
    enabled: true, maxSessions: 5, lavoriServer: true, proberWhenIdle: false,
    routineId: 'rA', routineIdB: 'rB', routineIdServer: porta === 'non-configurata' ? '' : 'rS', priorityAccount: 'B', accountAOff: true,
  });
  current.docs.set('routine-state/pacemaker', { lastSweepMs: NOW });
  current.docs.set('feedback/srv', {
    statusPublic: 'open', status: 'revision_capability', branch: 'claude/srv', priority: 2, seq: 1, subSeq: 0,
    createdAt: '2026-09-01T00:00:00Z', clientId: 'owner:x', fiducia: 'fidato', localOnly: { by: 'owner', at: '2026-10-01T00:00:00Z' },
  });
  const voce = (fiducia) => ({ scrittoDa: [{ fiducia, sha: 'a'.repeat(40), at: 1 }] });
  current.docs.set('routine-branches/app:claude~srv', voce(porta === 'ramo-app' ? 'non_fidato' : 'fidato'));
  current.docs.set('routine-branches/server:claude~srv', voce(porta === 'ramo-server' ? 'non_fidato' : 'fidato'));
  if (porta === 'scritto-sporco') current.docs.set('routine-state/srv', { branch: 'claude/srv', scrittoSporco: true });
}

const accensioni = [];
const fetchFinta = async (url) => {
  const m = String(url).match(/routines\/([^/]+)\/fire/);
  if (m) accensioni.push(m[1]);
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
};

preparaCoda();
if (porta === 'non-configurata') {
  current.docs.set('feedback/srv', { ...current.docs.get('feedback/srv'), status: 'todo', branch: '' });
  const r = await pm.runPacemaker({ nowMs: NOW, fetchImpl: fetchFinta });
  process.stdout.write(`\n${JSON.stringify({ esito: r, accensioni, logs })}\n`);
  process.exit(0);
}
const biglietti = [];
// Sei ore di pacemaker, un tick ogni dieci minuti; a ogni accensione la sessione nasce, sonda e chiede il biglietto.
for (let k = 0; k < 36; k++) {
  const t0 = NOW + k * 10 * MIN;
  const prima = accensioni.length;
  await pm.runPacemaker({ nowMs: t0, fetchImpl: fetchFinta });
  if (accensioni.length > prima) {
    const sonda = await channel.issueTicket({ passphrase: 'pw-server', probe: true, nowMs: t0 + 3 * MIN });
    const b = await channel.issueTicket({ passphrase: 'pw-server', nowMs: t0 + 4 * MIN, provaTimeoutMs: 1 });
    biglietti.push({ sonda: sonda.work === true, lavoro: b.work === true });
  }
}
process.stdout.write(`${JSON.stringify({ accensioniServer: accensioni.filter((a) => a === 'rS').length, biglietti })}\n`);
