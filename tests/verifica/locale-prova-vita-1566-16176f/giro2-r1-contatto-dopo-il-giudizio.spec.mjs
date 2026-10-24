// Verifica locale della prova di vita della voce server (#1566), giro 2, rilievo 1: una sessione della voce che chiede
// il biglietto dopo il giro del pacemaker che l'ha già giudicata lascia la voce in pausa mentre lavora.
// Il pacemaker e il canale veri su un Firestore finto; il server sta nel worktree di filo-security sullo stesso ramo.
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
const T = Date.parse('2026-10-24T15:47:39Z'); // un'accensione della voce A, come quella vera del 24/10
const PW_A = 'parola-server-a';

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
    'config/routines': { enabled: true, lavoriServer: true, maxSessions: 3, routineIdServer: 'srv-a', routineIdServerB: 'srv-b' },
    'routine-keys/server-2': {
      fp: secrets.fingerprint(PW_A), scope: 'routine', revoked: false, lavori: 'server', rete: 'limitata',
      ticketStamps: [], deliveryStamps: [], closingStamps: [],
    },
    'routine-state/pacemaker': {
      serverAccounts: { A: { lastFireMs: T, lastOutcome: 'ok', lastOutcomeDetail: '' } },
      pendingFires: [{ ms: T, account: 'server' }],
      dayKey: '2026-10-24', firesToday: 1, accounts: { A: { dayKey: '2026-10-24', firesToday: 1 } },
    },
  });
  require(path.join(F, 'src', 'data', 'firestore.js')).db = () => db();
  const log = require(path.join(F, 'src', 'log.js'));
  log.info = () => {};
  log.error = () => {};
  log.warn = () => {};
  require(path.join(F, 'src', 'routine', 'throttle.js')).reset();
  const channel = require(path.join(F, 'src', 'routine', 'channel.js'));
  const pm = require(path.join(F, 'src', 'routine', 'pacemaker.js'));
  const fetchMai = async () => { throw new Error('nessuna accensione attesa in questa prova'); };
  const voceA = () => ((db.doc('routine-state/pacemaker') || {}).serverAccounts || {}).A || {};
  return { channel, pm, fetchMai, voceA };
}

test('r1 una sessione della voce che chiede il biglietto dopo il giudizio del pacemaker toglie la pausa: la voce sta lavorando', async () => {
  const s = scenario();
  // Il giro del pacemaker dieci minuti dopo l'accensione non ha ancora sentito nessuno.
  await s.pm.runPacemaker({ nowMs: T + 10 * MIN + 2000, fetchImpl: s.fetchMai });
  // La sessione arriva un minuto dopo, chiede il biglietto e lavora.
  const r = await s.channel.issueTicket({ passphrase: PW_A, nowMs: T + 11 * MIN });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  await s.pm.runPacemaker({ nowMs: T + 20 * MIN + 2000, fetchImpl: s.fetchMai });
  expect(Number(s.voceA().blockedUntilMs) || 0, 'la voce ha una sessione che lavora: non resta in pausa').toBe(0);
  expect(s.voceA().strikes || 0, 'il fallimento contato per la sessione che poi è nata non resta').toBe(0);
});
