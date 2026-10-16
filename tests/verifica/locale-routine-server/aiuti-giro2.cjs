'use strict';
// Aiuto delle prove del giro 2 sulla routine server: pacemaker e canale veri del worktree omonimo di filo-security
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
  const PASS_S = 'parola-server-0123456789abcdef0123456789';
  const PASS_N = 'parola-normale-0123456789abcdef012345678';

  function prepara({ keyS = {}, coda = [], extra = {}, nowMs }) {
    mem = memFirestore(Object.assign({
      'config/routines': {
        enabled: true, lavoriServer: true, routineId: 'routA', routineIdB: 'routB', routineIdServer: 'routS',
        maxSessions: 3, proberWhenIdle: false, cap3: 6, cap2: 4, cap1: 1, cap0: 0,
      },
      'routine-keys/server': Object.assign({ fp: secrets.fingerprint(PASS_S), scope: 'routine', rete: 'limitata', lavori: 'server', account: 'B' }, keyS),
      'routine-keys/normale': { fp: secrets.fingerprint(PASS_N), scope: 'routine', rete: 'limitata', account: 'B' },
      'routine-state/pacemaker': { lastSweepMs: nowMs + 10 * 24 * 3600e3 },
    }, extra));
    items = coda;
    righe.length = 0;
  }
  async function giro(nowMs) {
    const chiamate = [];
    const fetchImpl = async (url) => { chiamate.push(String(url)); return { ok: true, status: 200, json: async () => ({}) }; };
    await pm.runPacemaker({ nowMs, fetchImpl });
    return chiamate.filter((u) => /\/routines\//.test(u)).map((u) => decodeURIComponent(u.split('/routines/')[1].split('/')[0]));
  }
  const sonda = (nowMs) => channel.issueTicket({ passphrase: PASS_S, probe: true, nowMs });
  const biglietto = (nowMs) => channel.issueTicket({ passphrase: PASS_S, nowMs, provaTimeoutMs: 1 });
  return { prepara, giro, sonda, biglietto, righe };
}

const lavoroServer = (id, extra = {}) => Object.assign({
  _id: id, seq: 900, status: 'todo', statusPublic: 'open', fiducia: 'fidato', priority: 2,
  createdAt: '2026-10-01T00:00:00Z', localOnly: { by: 'owner', at: 1 },
}, extra);

// Una giornata (UTC) di giri ogni dieci minuti; a ogni accensione della routine server la sua sessione sonda e chiede.
async function giornata(b, opts) {
  const t0 = Date.UTC(2026, 9, 16, 0, 5, 0);
  b.prepara(Object.assign({ nowMs: t0 }, opts));
  let accensioni = 0;
  let lavori = 0;
  const sondaggi = [];
  for (let t = t0; t < Date.UTC(2026, 9, 17); t += 600e3) {
    if (!(await b.giro(t)).includes('routS')) continue;
    accensioni += 1;
    const s = await b.sonda(t + 60e3);
    sondaggi.push(s.work === true);
    if (s.work === true && (await b.biglietto(t + 120e3)).work === true) lavori += 1;
  }
  const avvisi = b.righe.filter((x) => x.lv !== 'info').map((x) => `${x.ev} ${JSON.stringify(x.ctx)}`);
  return { accensioni, lavori, sondaggiConLavoro: sondaggi.filter(Boolean).length, avvisi };
}

const SCENARI = {
  // Un lavoro server da fare, senza ramo, con lo stato del giro segnato «scritto da un biglietto sporco».
  'scritto-sporco-senza-ramo': (b) => giornata(b, {
    coda: [lavoroServer('f6')],
    extra: { 'routine-state/f6': { scrittoSporco: true, scrittoSporcoDa: [{ biglietto: 'z', at: 1 }] } },
  }),
  // La chiave della routine server senza «rete limitata» (il valore con cui nasce una chiave).
  'chiave-server-rete-aperta': (b) => giornata(b, { coda: [lavoroServer('f7')], keyS: { rete: 'aperta' } }),
  // Controllo del banco: lo stesso lavoro, pulito e con la chiave giusta, si prende alla prima accensione.
  'controllo-pulito': (b) => giornata(b, { coda: [lavoroServer('f1')] }),
};

if (require.main === module) {
  (async () => {
    if (!SERVER) { process.stdout.write(JSON.stringify({ senzaServer: true })); return; }
    const out = await SCENARI[process.argv[2]](banco());
    process.stdout.write(JSON.stringify(out));
  })().catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });
}

module.exports = { SERVER };
