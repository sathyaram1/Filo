// Verifica locale «fiducia» (#1148), giro 2, rilievo 1: una sessione pulita viva da prima copre i commit che una
// sessione sporca ha scritto in parallelo sullo stesso ramo. Server vero (callable localTicket), Firestore in memoria.
import { test, expect } from './../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const RADICE = join(import.meta.dirname, '..', '..', '..');
function funzioniDelServer() {
  let ramo = '';
  try { ramo = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: RADICE, encoding: 'utf8' }).trim(); } catch (_) {}
  const slug = ramo.replace(/^claude\//, '');
  let d = RADICE;
  for (let i = 0; i < 8; i++) {
    const srv = join(dirname(d), 'filo-security');
    for (const c of [join(srv, '.claude', 'worktrees', slug, 'functions'), join(srv, 'functions')]) {
      if (slug && existsSync(join(c, 'src', 'routine', 'localTicket.js'))) return c;
    }
    d = dirname(d);
  }
  return '';
}

const SRV = funzioniDelServer();
const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 11, 8, 0, 0);
const RAMO = 'claude/parallelo';
const X = 'a'.repeat(40);

function server() {
  const require = createRequire(join(SRV, 'index.js'));
  const { memFirestore } = require(join(SRV, 'test', 'fixtures', 'firestore-mem'));
  const fsMod = require(join(SRV, 'src', 'data', 'firestore'));
  const mem = memFirestore({});
  fsMod.db = () => mem();
  const store = require(join(SRV, 'src', 'routine', 'store'));
  const { runLocalTicket } = require(join(SRV, 'src', 'routine', 'localTicket'));
  let n = 0;
  const op = (nowMs, o, data = {}) => runLocalTicket({
    admin: true, op: o, data,
    deps: { store, nowMs, newSecret: () => `segreto-${++n}-${'x'.repeat(40)}`, readFeedbackRaw: async () => ({ fiducia: 'fidato' }) },
  });
  return { op };
}

test('r1 i commit di una sessione sporca, ripresi da una sessione pulita già viva, non entrano come lavoro fidato', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const s = server();
  // 8:00 l'owner apre una sessione pulita (per altro). 8:10 una seconda sessione legge un feedback di un utente e si sporca.
  const pulita = await s.op(T0, 'prendi');
  const sporca = await s.op(T0 + 10 * MIN, 'prendi');
  await s.op(T0 + 12 * MIN, 'sporca', { ticket: sporca.ticket, motivo: 'letto #999: testo di un feedback non fidato' });
  expect((await s.op(T0 + 13 * MIN, 'stato', { ticket: sporca.ticket })).fiducia).toBe('non_fidato');
  // 8:20 la sessione sporca scrive e spinge X sul ramo (il salvataggio automatico non registra niente).
  // 9:00 la sessione pulita riprende il ramo: verify-local start registra la punta X coi commit del ramo.
  const ora = T0 + 60 * MIN;
  const r = await s.op(ora, 'ramo', { ticket: pulita.ticket, repo: 'app', ramo: RAMO, sha: X, feedbackId: 'fb1', commits: [{ sha: X, at: T0 + 20 * MIN }], ora });
  expect(r.ok).toBe(true);
  expect(r.ramoFidato, 'X l’ha scritto una sessione sporca: il lavoro non può risultare fidato').toBe(false);
});
