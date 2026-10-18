// Verifica locale «fiducia» (#1148), giro 3 (dal giro 2), rilievo 1: il registro attribuisce i commit per finestra di
// tempo e non per chi li ha scritti, quindi una sessione pulita copre i commit di una sporca. Server vero (callable localTicket), Firestore in memoria.
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
  // Il registro del server prende `db` al primo require: ogni caso passa dalla stessa porta, che punta alla sua memoria.
  globalThis.__memSessioniParallele = memFirestore({});
  fsMod.db = () => globalThis.__memSessioniParallele();
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

test('r1 un commit di una sessione sporca con la data d’autore spostata indietro non entra come lavoro fidato', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const s = server();
  const C1 = 'b'.repeat(40);
  const C2 = 'c'.repeat(40);
  // 8:00-8:30 una sessione pulita scrive C1 (il suo pre-push lo dichiara, #1362) e registra il ramo, poi chiude.
  const prima = await s.op(T0, 'prendi');
  await s.op(T0 + 11 * MIN, 'spinte', { ticket: prima.ticket, spinte: [{ repo: 'app', ramo: RAMO, punta: C1, commits: [C1] }] });
  const r1 = await s.op(T0 + 30 * MIN, 'ramo', { ticket: prima.ticket, repo: 'app', ramo: RAMO, sha: C1, feedbackId: 'fb1', commits: [{ sha: C1, at: T0 + 10 * MIN }], ora: T0 + 30 * MIN });
  expect(r1.ramoFidato).toBe(true);
  await s.op(T0 + 31 * MIN, 'chiudi', { ticket: prima.ticket });
  // 9:00 una sessione sporca scrive C2 con la data d'autore delle 8:15 (git commit --date) e spinge senza registrare.
  // 10:00 una sessione pulita nuova riprende il ramo e registra la punta C2.
  const dopo = await s.op(T0 + 120 * MIN, 'prendi');
  const ora = T0 + 125 * MIN;
  const r2 = await s.op(ora, 'ramo', { ticket: dopo.ticket, repo: 'app', ramo: RAMO, sha: C2, feedbackId: 'fb1', commits: [{ sha: C2, at: T0 + 15 * MIN }, { sha: C1, at: T0 + 10 * MIN }], ora });
  expect(r2.ok).toBe(true);
  expect(r2.ramoFidato, 'C2 l’ha scritto una sessione sporca: la data d’autore la sceglie chi scrive il commit').toBe(false);
});
