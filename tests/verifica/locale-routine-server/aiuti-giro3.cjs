'use strict';
// Aiuto delle prove del giro 3 sulla routine server: pacemaker e canale veri del worktree omonimo di filo-security
// (o FILO_SECURITY_DIR) su Firestore in memoria. Un processo per scenario; stampa l'esito in JSON. Non è una prova.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER = [
  process.env.FILO_SECURITY_DIR || '',
  path.resolve(ROOT, '..', '..', '..', '..', 'filo-security', '.claude', 'worktrees', path.basename(ROOT)),
  path.resolve(ROOT, '..', 'filo-security'),
].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'functions', 'src', 'routine', 'pacemaker.js'))) || '';
const F = SERVER ? path.join(SERVER, 'functions') : '';

const PASS_S = 'parola-server-0123456789abcdef0123456789';
const PASS_S2 = 'parola-server-nuova-0123456789abcdef0123';
const PASS_N = 'parola-normale-0123456789abcdef012345678';
const T0 = Date.UTC(2026, 9, 16, 0, 5, 0);
const OGGI = '2026-10-16';

function banco() {
  const { memFirestore } = require(path.join(F, 'test/fixtures/firestore-mem'));
  let mem = memFirestore();
  const fsMod = require(path.join(F, 'src/data/firestore'));
  fsMod.db = () => { const a = mem(); a.getAll = (...refs) => Promise.all(refs.map((r) => r.get())); return a; };
  const log = require(path.join(F, 'src/log'));
  const righe = [];
  for (const lv of ['info', 'warn', 'error']) log[lv] = (ev, ctx) => { righe.push({ lv, ev, ctx: ctx || {} }); };
  const queue = require(path.join(F, 'src/routine/queue'));
  let items = [];
  queue.readOpenFeedbacks = async () => ({ items: JSON.parse(JSON.stringify(items)), unreadable: 0 });
  queue.resolveGenerations = async () => new Map();
  const pm = require(path.join(F, 'src/routine/pacemaker'));
  const channel = require(path.join(F, 'src/routine/channel'));
  const secrets = require(path.join(F, 'src/routine/secrets'));
  process.env.CC_ROUTINE_FIRE_TOKEN = 'tokA';
  process.env.CC_ROUTINE_FIRE_TOKEN_B = 'tokB';
  process.env.CC_ROUTINE_FIRE_TOKEN_SERVER = 'tokS';

  function prepara({ cfg = {}, chiavi = {}, pace = {}, coda = [] }) {
    mem = memFirestore(Object.assign({
      'config/routines': Object.assign({
        enabled: true, lavoriServer: true, routineId: 'routA', routineIdB: 'routB', routineIdServer: 'routS',
        maxSessions: 3, proberWhenIdle: false, cap3: 6, cap2: 4, cap1: 1, cap0: 0,
      }, cfg),
      'routine-keys/server': { fp: secrets.fingerprint(PASS_S), scope: 'routine', rete: 'limitata', lavori: 'server', account: 'B' },
      'routine-keys/normale': { fp: secrets.fingerprint(PASS_N), scope: 'routine', rete: 'limitata', account: 'B' },
      'routine-state/pacemaker': Object.assign({ lastSweepMs: T0 + 10 * 24 * 3600e3 }, pace),
    }, Object.fromEntries(Object.entries(chiavi).map(([slug, d]) => [`routine-keys/${slug}`, Object.assign({ scope: 'routine' }, d,
      d.pass ? { fp: secrets.fingerprint(d.pass), pass: undefined } : {})]))));
    items = coda;
    righe.length = 0;
  }
  async function giro(nowMs) {
    const chiamate = [];
    const fetchImpl = async (url) => { chiamate.push(String(url)); return { ok: true, status: 200, json: async () => ({}) }; };
    await pm.runPacemaker({ nowMs, fetchImpl });
    return chiamate.filter((u) => /\/routines\//.test(u)).map((u) => decodeURIComponent(u.split('/routines/')[1].split('/')[0]));
  }
  const sonda = (nowMs, pass = PASS_S) => channel.issueTicket({ passphrase: pass, probe: true, nowMs });
  const biglietto = (nowMs, pass = PASS_S) => channel.issueTicket({ passphrase: pass, nowMs, provaTimeoutMs: 1 });
  const rilascia = async (r, nowMs) => { if (r && r.ticket) await channel.release({ ticket: r.ticket, nowMs }); };
  return { prepara, giro, sonda, biglietto, rilascia, righe };
}

const lavoroServer = (id, extra = {}) => Object.assign({
  _id: id, seq: 900, status: 'todo', statusPublic: 'open', fiducia: 'fidato', priority: 2,
  createdAt: '2026-10-01T00:00:00Z', localOnly: { by: 'owner', at: 1 },
}, extra);

// Una giornata (UTC) di giri ogni dieci minuti; a ogni accensione della routine server la sua sessione sonda, chiede e
// rilascia (il lavoro server dopo torna in coda: è un lavoro nuovo ogni volta, come una coda di lavori server).
async function giornata(b, opts, pass = PASS_S) {
  b.prepara(opts);
  const accese = { routA: 0, routB: 0, routS: 0 };
  let lavori = 0;
  for (let t = T0; t < Date.UTC(2026, 9, 17); t += 600e3) {
    const g = await b.giro(t);
    for (const r of g) accese[r] = (accese[r] || 0) + 1;
    if (!g.includes('routS')) continue;
    const s = await b.sonda(t + 60e3, pass);
    if (s.work !== true) continue;
    const bi = await b.biglietto(t + 120e3, pass);
    if (bi.work === true) { lavori += 1; await b.rilascia(bi, t + 180e3); }
  }
  const avvisi = b.righe.filter((x) => x.lv !== 'info').map((x) => `${x.ev} ${JSON.stringify(x.ctx)}`);
  return { accese, lavori, avvisi };
}

const SCENARI = {
  // B ha già acceso dodici volte oggi (il tetto per account): la routine server gira su B.
  'tetto-di-b': async (b) => {
    const pace = { dayKey: OGGI, firesToday: 24, accounts: { A: { dayKey: OGGI, firesToday: 12 }, B: { dayKey: OGGI, firesToday: 12 } } };
    const out = await giornata(b, { pace, coda: [lavoroServer('srv1')] });
    return Object.assign(out, { accensioniSuB: 12 + out.accese.routB + out.accese.routS });
  },
  'b-escluso': async (b) => giornata(b, { cfg: { accountBOff: true }, coda: [lavoroServer('srv1')] }),
  'controllo-pulito': async (b) => giornata(b, { coda: [lavoroServer('srv1')] }),
  // Chiave server nuova, a rete aperta come nasce, già nel prompt della routine; la vecchia, limitata, non ancora revocata.
  'chiave-server-ruotata': async (b) => giornata(b, {
    chiavi: { 'server-nuova': { pass: PASS_S2, lavori: 'server', account: 'B' } }, coda: [lavoroServer('srv1')],
  }, PASS_S2),
};

if (require.main === module) {
  const nome = process.argv[2];
  const fn = SCENARI[nome];
  if (!fn || !F) { process.stderr.write(`scenario sconosciuto o server assente: ${nome}\n`); process.exit(2); }
  fn(banco()).then((out) => { process.stdout.write(JSON.stringify(out)); process.exit(0); },
    (e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });
}

module.exports = { SERVER };
