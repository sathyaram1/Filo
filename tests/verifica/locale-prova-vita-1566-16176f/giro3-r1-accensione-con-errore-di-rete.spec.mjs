// Verifica locale della prova di vita della voce server (#1566), giro 3, rilievo 1: l'accensione della voce risponde
// con un errore di rete o un 5xx ma la sessione nasce e chiede il biglietto; la voce resta in pausa mentre lavora.
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
const T = Date.parse('2026-10-25T08:00:00Z');
const PW_A = 'parola-server-a';

function scenario(errore) {
  expect(F, 'il worktree di filo-security non si trova: imposta FILO_SERVER_DIR').not.toBe('');
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.normalize(F))) delete require.cache[k];
  process.env.CC_ROUTINE_FIRE_TOKEN_SERVER = 'tok-srv-a';
  delete process.env.CC_ROUTINE_FIRE_TOKEN_SERVER_B;
  delete process.env.CC_ROUTINE_FIRE_TOKEN;
  delete process.env.CC_ROUTINE_FIRE_TOKEN_B;
  const { memFirestore } = require(path.join(F, 'test', 'fixtures', 'firestore-mem.js'));
  const secrets = require(path.join(F, 'src', 'routine', 'secrets.js'));
  const db = memFirestore({
    'config/routines': { enabled: true, lavoriServer: true, maxSessions: 1, routineIdServer: 'srv-a' },
    'routine-keys/server-a': {
      fp: secrets.fingerprint(PW_A), scope: 'routine', revoked: false, lavori: 'server', rete: 'limitata', account: 'A',
      ticketStamps: [], deliveryStamps: [], closingStamps: [],
    },
    'feedback/s1': {
      statusPublic: 'open', status: 'todo', priority: 3, seq: 70, subSeq: 0, name: 'Server', text: 'x',
      createdAt: '2026-10-01T00:00:00Z', clientId: 'owner:x', notes: '', fiducia: 'fidato',
      localOnly: { by: 'owner', at: '2026-10-01T00:00:00Z' },
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
  // claude.ai crea la sessione, ma la risposta alla POST si perde (rete) o torna come errore del server.
  const fetchAccende = async () => {
    if (errore === 'network') throw new Error('socket hang up');
    return { ok: false, status: 503, text: async () => 'upstream timeout' };
  };
  const fetchMai = async () => { throw new Error('nessuna accensione attesa dopo la prima'); };
  const voceA = () => ((db.doc('routine-state/pacemaker') || {}).serverAccounts || {}).A || {};
  return { channel, pm, fetchAccende, fetchMai, voceA };
}

for (const errore of ['network', 'http_503']) {
  test(`r1 accensione con esito ${errore}: la sessione nata chiede il biglietto e la voce non resta in pausa`, async () => {
    const s = scenario(errore);
    await s.pm.runPacemaker({ nowMs: T, fetchImpl: s.fetchAccende });
    expect(s.voceA().lastFireMs).toBe(T);
    // La sessione nata da quell'accensione chiede il biglietto un minuto dopo, come fa l'orchestratore, e lavora.
    const r = await s.channel.issueTicket({ passphrase: PW_A, nowMs: T + MIN });
    expect([r.ok, r.work], JSON.stringify(r)).toEqual([true, true]);
    await s.pm.runPacemaker({ nowMs: T + 11 * MIN, fetchImpl: s.fetchMai });
    expect(Number(s.voceA().blockedUntilMs) || 0, 'la voce ha una sessione che lavora: non resta in pausa').toBe(0);
    expect(s.voceA().strikes || 0, 'il fallimento contato per la sessione che poi è nata non resta').toBe(0);
  });
}
