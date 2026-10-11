// Verifica locale «fiducia» (#1148), giro 1, rilievo 2: una sessione locale resta o nasce pulita mentre continua un
// lavoro sporco. Server vero del biglietto locale con Firestore in memoria; l'hook di avvio vero con un server finto.
import { test, expect } from './../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

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
const A = 'a'.repeat(40); const B = 'b'.repeat(40);

test('r2 una sessione pulita che prende un ramo già scritto da una sessione sporca si sporca', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const require = createRequire(join(SRV, 'index.js'));
  const { memFirestore } = require(join(SRV, 'test', 'fixtures', 'firestore-mem'));
  const fsMod = require(join(SRV, 'src', 'data', 'firestore'));
  fsMod.db = () => globalThis.__memVerifica1148();
  const { runLocalTicket } = require(join(SRV, 'src', 'routine', 'localTicket'));
  const mem = memFirestore({ 'feedback/fid': { fiducia: 'fidato', status: 'working' } });
  globalThis.__memVerifica1148 = () => mem();
  const op = (o, data = {}) => runLocalTicket({ admin: true, op: o, data, deps: { readFeedbackRaw: async (id) => mem.doc(`feedback/${id}`) || null } });

  // La sessione di ieri ha letto il testo di un utente e ha registrato il ramo (verify-local start o finish).
  const ieri = await op('prendi', { sporco: true, motivo: 'letto il feedback di un utente' });
  await op('ramo', { ticket: ieri.ticket, repo: 'app', ramo: 'claude/x', sha: A, feedbackId: 'fid' });
  // Oggi una sessione nuova, pulita, riprende lo stesso ramo: il server le risponde che il ramo non è fidato.
  const oggi = await op('prendi');
  const r = await op('ramo', { ticket: oggi.ticket, repo: 'app', ramo: 'claude/x', sha: B, feedbackId: 'fid' });
  expect(r.ramoFidato).toBe(false);
  // …ma la sessione resta pulita: quello che scrive da qui (un feedback, un altro ramo) nasce fidato.
  expect((await op('stato', { ticket: oggi.ticket })).fiducia).toBe('non_fidato');
});

test('r2 il figlio di una sessione sporca non nasce pulito se lo stato del padre non si legge in tempo', async () => {
  const B_LOC = await import(pathToFileURL(join(RADICE, 'scripts', 'lib', 'biglietto-locale.mjs')).href);
  const repo = cartellaTemporanea('verifica-1148-avvio-');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const padre = join(repo, 'padre.json');
  writeFileSync(padre, JSON.stringify({ ticket: 'p'.repeat(43), fp: 'a'.repeat(64), natoIl: 1 }));
  const chiamate = [];
  // Il padre è sporco; la prima chiamata (lo stato del padre) cade per una partenza a freddo, la seconda risponde.
  const fetchImpl = async (_url, opts) => {
    const { data } = JSON.parse(opts.body);
    chiamate.push(data.op);
    if (data.op === 'stato') throw new TypeError('fetch failed');
    if (data.op === 'prendi') return { ok: true, status: 200, json: async () => ({ result: { ok: true, ticket: 'n'.repeat(43), fp: 'b'.repeat(64), fiducia: data.sporco ? 'non_fidato' : 'fidato' } }) };
    return { ok: true, status: 200, json: async () => ({ result: { ok: true } }) };
  };
  const envFile = join(repo, 'env.sh');
  writeFileSync(envFile, '');
  const r = await B_LOC.avvio({
    input: { session_id: 'figlio-1', source: 'startup' },
    env: { FILO_BIGLIETTO_FILE: padre, CLAUDE_ENV_FILE: envFile },
    cwd: repo, deps: { fetchImpl, idToken: async () => 'tok' }, haCredenziale: async () => true,
  });
  expect(r.riga, `chiamate: ${chiamate.join(', ')}`).not.toMatch(/pulito/);
});
