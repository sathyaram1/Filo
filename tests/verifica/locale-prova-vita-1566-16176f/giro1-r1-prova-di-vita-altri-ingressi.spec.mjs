// Verifica locale della prova di vita della voce server (#1566), giro 1, rilievo 1: una chiamata autenticata da una
// chiave della voce che NON è il biglietto (domanda di fine sessione con la parola d'ordine, battito col biglietto)
// non timbra la voce, che dopo la finestra viene data per nata morta. Il pacemaker vero su un Firestore finto.
// Il server sta nel worktree di filo-security sullo stesso ramo (FILO_SERVER_DIR per sceglierne un altro).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function cartellaServer() {
  if (process.env.FILO_SERVER_DIR) return process.env.FILO_SERVER_DIR;
  const root = ROOT.replace(/\\/g, '/');
  const m = root.match(/^(.*)\/Filo\/\.claude\/worktrees\/([^/]+)$/);
  const base = m ? `${m[1]}/filo-security` : path.resolve(ROOT, '..', 'filo-security');
  const candidati = [];
  // Prima il worktree di filo-security sullo stesso ramo dell'app, qualunque nome abbia la sua cartella.
  try {
    const ramo = execFileSync('git', ['-C', ROOT, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
    const lista = execFileSync('git', ['-C', base, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
    let dir = '';
    for (const riga of lista.split('\n')) {
      if (riga.startsWith('worktree ')) dir = riga.slice('worktree '.length).trim();
      else if (ramo && riga.trim() === `branch refs/heads/${ramo}` && dir) candidati.push(dir);
    }
  } catch (_) { /* senza git si va per nome */ }
  if (m) candidati.push(`${base}/.claude/worktrees/${m[2]}`);
  candidati.push(base);
  return candidati.find((c) => existsSync(path.join(c, 'functions', 'src', 'routine', 'pacemaker.js'))) || '';
}

const SRV = cartellaServer();
const F = SRV ? path.join(SRV, 'functions') : '';
const MIN = 60 * 1000;
const T = Date.parse('2026-10-23T09:00:00Z'); // l'accensione della voce B
const PW_B = 'parola-server-b';

/** Il server appena dopo l'accensione di B (esito ok), con la chiave server di B viva a rete limitata. */
function scenario() {
  expect(F, 'il worktree di filo-security non si trova: imposta FILO_SERVER_DIR').not.toBe('');
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.normalize(F))) delete require.cache[k];
  process.env.CC_ROUTINE_FIRE_TOKEN_SERVER = 'tok-srv-a';
  process.env.CC_ROUTINE_FIRE_TOKEN_SERVER_B = 'tok-srv-b';
  delete process.env.CC_ROUTINE_FIRE_TOKEN;
  delete process.env.CC_ROUTINE_FIRE_TOKEN_B;
  const { memFirestore } = require(path.join(F, 'test', 'fixtures', 'firestore-mem.js'));
  const secrets = require(path.join(F, 'src', 'routine', 'secrets.js'));
  const db = memFirestore({
    'config/routines': { enabled: true, lavoriServer: true, maxSessions: 2, routineIdServer: 'srv-a', routineIdServerB: 'srv-b' },
    'routine-keys/srv-b': {
      fp: secrets.fingerprint(PW_B), scope: 'routine', revoked: false, lavori: 'server', account: 'B', rete: 'limitata',
      ticketStamps: [], deliveryStamps: [], closingStamps: [],
    },
    'routine-state/pacemaker': {
      serverAccounts: { B: { lastFireMs: T, lastOutcome: 'ok', lastOutcomeDetail: '' } },
      pendingFires: [{ ms: T, account: 'server' }],
      dayKey: '2026-10-23', firesToday: 1, accounts: { B: { dayKey: '2026-10-23', firesToday: 1 } },
    },
  });
  require(path.join(F, 'src', 'data', 'firestore.js')).db = () => db();
  const log = require(path.join(F, 'src', 'log.js'));
  const pause = [];
  log.info = () => {};
  log.error = () => {};
  log.warn = (m, f) => { if (m === 'pacemaker.server_paused') pause.push(f || {}); };
  require(path.join(F, 'src', 'routine', 'throttle.js')).reset();
  const channel = require(path.join(F, 'src', 'routine', 'channel.js'));
  const closing = require(path.join(F, 'src', 'routine', 'closing.js'));
  const pm = require(path.join(F, 'src', 'routine', 'pacemaker.js'));
  const fetchMai = async () => { throw new Error('nessuna accensione attesa in questa prova'); };
  const voceB = () => ((db.doc('routine-state/pacemaker') || {}).serverAccounts || {}).B || {};
  return { db, secrets, channel, closing, pm, pause, fetchMai, voceB };
}

test('r1 la domanda di fine sessione con la parola d’ordine di B, dopo l’accensione, vale come prova di vita: B non va in pausa', async () => {
  const s = scenario();
  // La sessione nata dall'accensione muore nel setup, prima del biglietto, e chiude con la domanda dell'owner.
  const r = await s.closing.handle({ passphrase: PW_B, op: 'question' }, { nowMs: T + 3 * MIN });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  await s.pm.runPacemaker({ nowMs: T + 12 * MIN, fetchImpl: s.fetchMai });
  expect(s.voceB().strikes, 'una chiamata autenticata dalla chiave di B dopo l’accensione: B è viva, fallimenti azzerati').toBe(0);
  expect(Number(s.voceB().blockedUntilMs) || 0, 'nessuna pausa').toBe(0);
  expect(s.pause, 'nessun avviso di voce in pausa').toEqual([]);
});

test('r1 il battito col biglietto di una sessione di B, dopo l’accensione, vale come prova di vita: B non va in pausa', async () => {
  const s = scenario();
  const fp = s.secrets.fingerprint('biglietto-b-in-corso');
  const leaseId = 'feedback:x1';
  await s.db().doc(`routine-tickets/${fp}`).set({
    slug: 'srv-b', role: 'verifier', feedbackId: 'x1', num: '1', branch: 'w/x1', leaseId,
    createdAtMs: T - 20 * MIN, pickupBy: T - 10 * MIN, openedAtMs: T - 19 * MIN,
    released: false, deliveryStamps: [], deliveryCount: 0,
  });
  await s.db().doc(`routine-leases/${leaseId}`).set({
    holder: fp, slug: 'srv-b', role: 'verifier', acquiredAtMs: T - 20 * MIN, expiresAtMs: T + 40 * MIN, released: false,
  });
  const r = await s.channel.heartbeat({ ticket: 'biglietto-b-in-corso', nowMs: T + 3 * MIN });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  await s.pm.runPacemaker({ nowMs: T + 12 * MIN, fetchImpl: s.fetchMai });
  expect(s.voceB().strikes, 'un battito di una chiave di B dopo l’accensione: B è viva').toBe(0);
  expect(Number(s.voceB().blockedUntilMs) || 0, 'nessuna pausa').toBe(0);
});
