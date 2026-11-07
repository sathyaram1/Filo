// Le dichiarazioni delle spinte (#1362) sulle strade vere, non i pezzi chiamati a mano: la spinta del worker su
// filo-security, la registrazione del suo ramo, la consegna delle routine, l'avvio e la chiusura della sessione locale.
// Se un collegamento si rompe ogni lavoro risulta non fidato in silenzio: qui diventa rosso (#1867 giro 2).

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { URL_SERVER } from '../../scripts/lib/git-server.mjs';
import { dichiaraSpintaServer, eseguiGitServer } from '../../scripts/routine-channel.mjs';
import { writeTicket } from '../../scripts/lib/routine-ticket.mjs';
import { SEGNO_PRE_PUSH } from '../../scripts/lib/copie-di-dati.mjs';
import * as S from '../../scripts/lib/spinte.mjs';
import * as B from '../../scripts/lib/biglietto-locale.mjs';

const { writeBranchState, withCheckpoint, writeExpectation, ensureSessionExcludes } = await import('../../scripts/lib/branch-integrity.mjs');

const CANALE = fileURLToPath(new URL('../../scripts/routine-channel.mjs', import.meta.url));
const RAMO = 'worker/1867-strade';
const ID = 'fid-1867';
const BIGLIETTO = `B1-${'x'.repeat(40)}`;
const g = (cwd, args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const coda = (dir) => S.vociInCoda(S.cartellaCoda(dir));

/** Un origin nudo e la sua copia su RAMO, con un commit di base su main. */
function copia(casa, nome) {
  const origin = join(casa, `${nome}.git`);
  const dir = join(casa, nome);
  mkdirSync(origin); mkdirSync(dir);
  g(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  g(dir, ['init', '-q', '--initial-branch=main']);
  g(dir, ['remote', 'add', 'origin', origin]);
  g(dir, ['config', 'user.email', 't@t']); g(dir, ['config', 'user.name', 't']);
  writeFileSync(join(dir, '.gitignore'), '.claude/\n');
  g(dir, ['add', '-A']); g(dir, ['commit', '-q', '-m', 'base']);
  g(dir, ['push', '-q', 'origin', 'main']);
  g(dir, ['remote', 'set-head', 'origin', 'main']);
  g(dir, ['checkout', '-q', '-b', RAMO]);
  return { origin, dir };
}

function committa(dir, file, env) {
  writeFileSync(join(dir, file), `${file}\n`);
  g(dir, ['add', '-A']);
  execFileSync('git', ['commit', '-q', '-m', file], { cwd: dir, stdio: 'ignore', ...(env ? { env: { ...process.env, ...env } } : {}) });
  return g(dir, ['rev-parse', 'HEAD']);
}

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* lo dicono gli assert */ }
      const url = String(req.url || '');
      ricevuti.push({ url, body: j });
      res.setHeader('Content-Type', 'application/json');
      if (url.includes('routineRamoServer')) res.end(JSON.stringify({ ok: true, sha: j.sha, ramoFidato: true, fiducia: 'fidato' }));
      else res.end(JSON.stringify({ ok: true, id: ID, num: '#1867' }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

/** Il canale lanciato come lo lanciano i worker, verso il server finto: fuori dal contesto delle prove, come davvero. */
function canale(work, port, extra = {}) {
  const env = { ...process.env, FILO_REPO_ROOT: work, FILO_TOOLS_ROOT: work, FILO_NO_BEAT: '1', FILO_ROUTINE_API: `http://127.0.0.1:${port}`, ...extra };
  for (const k of ['NODE_TEST_CONTEXT', 'FILO_DISPATCH_STATE_DIR', 'FILO_ROUTINE']) delete env[k];
  return (args) => new Promise((r) => execFile(process.execPath, [CANALE, ...args], { env, cwd: work },
    (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') })));
}

test('git-server push vero: i commit del worker si leggono prima della spinta e partono col suo biglietto per filo-security', async () => {
  const casa = cartellaTemporanea('filo-strade-push-');
  try {
    const app = copia(casa, 'Filo');
    committa(app.dir, 'regola.js');
    writeTicket(app.dir, BIGLIETTO);
    const server = copia(casa, 'filo-security');
    dichiaraSpintaServer.traccia(server.dir);
    // Il commit lo fa il worker col suo biglietto: la traccia lo annota a suo nome.
    const w = committa(server.dir, 'funzione.js', { FILO_ROUTINE_TICKET: BIGLIETTO });
    const righe = [];
    const lancia = (argv, o) => (argv.includes('get-url')
      ? { status: 0, stdout: `${URL_SERVER}\n` }
      : spawnSync('git', argv, { ...o, stdio: ['ignore', 'pipe', 'pipe'] }));
    const exit = await eseguiGitServer({
      azione: 'push', cartella: server.dir, ramo: RAMO, biglietto: BIGLIETTO, root: app.dir, env: {},
      lancia, token: async () => ({ outcome: 'ok', token: 'ghs_finto' }), scrivi: (r) => righe.push(r), eco: () => {},
    });
    assert.equal(exit, 0, righe.join('\n'));
    assert.equal(g(server.origin, ['rev-parse', `refs/heads/${RAMO}`]), w, 'la spinta è arrivata');
    const voci = coda(server.dir);
    assert.deepEqual(voci.map((v) => [v.tipo, v.repo, v.commits]), [['routine', 'server', [w]]], 'la spinta è in coda per il server, col commit del worker');
    // Letti dopo la spinta, il ref remoto li conterrebbe già e non si dichiarerebbe niente: l'ordine è il collegamento.
    assert.deepEqual((dichiaraSpintaServer.prima(server.dir, RAMO) || { commits: [] }).commits, []);
  } finally { togliCartella(casa); }
});

test('ramo-server dalla riga di comando, col clone presente: prima le spinte in coda, poi la registrazione con l’elenco dei commit', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = cartellaTemporanea('filo-strade-ramo-server-');
  try {
    const app = copia(casa, 'Filo');
    const server = copia(casa, 'filo-security');
    const w = committa(server.dir, 'funzione.js');
    S.accoda(server.dir, { tipo: 'routine', ticket: BIGLIETTO }, 'server', [{ ramo: RAMO, punta: w, commits: [w] }]);
    const r = await canale(app.dir, port, { FILO_SERVER_CLONE: server.dir })(['ramo-server', RAMO, w, '--ticket', BIGLIETTO]);
    assert.equal(r.code, 0, r.se);
    assert.deepEqual(ricevuti.map((x) => x.url.split('/').pop()), ['routineSpinte', 'routineRamoServer']);
    assert.deepEqual(ricevuti[0].body.spinte, [{ repo: 'server', ramo: RAMO, commits: [w], punta: w }]);
    const commits = ricevuti[1].body.commits;
    assert.ok(Array.isArray(commits) && commits.some((c) => c.sha === w), JSON.stringify(ricevuti[1].body));
    assert.deepEqual(coda(server.dir), [], 'la coda si è svuotata');
  } finally { srv.close(); togliCartella(casa); }
});

test('la consegna di una correzione dalla riga di comando: prima le spinte in coda, poi la consegna con l’elenco dei commit', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = cartellaTemporanea('filo-strade-consegna-');
  try {
    const app = copia(casa, 'Filo');
    ensureSessionExcludes(app.dir);
    writeBranchState(app.dir, withCheckpoint({ id: ID, branch: RAMO }, g(app.dir, ['rev-parse', 'HEAD']), 'new-work:checkout'));
    writeExpectation(app.dir, { branch: RAMO, id: ID });
    const c = committa(app.dir, 'lavoro.txt');
    S.accoda(app.dir, { tipo: 'routine', ticket: BIGLIETTO }, 'app', [{ ramo: RAMO, punta: c, commits: [c] }]);
    const r = await canale(app.dir, port)(['deliver', BIGLIETTO, 'fixed', '--report', 'Corretto il salvataggio col titolo vuoto: ora salva anche senza titolo.']);
    assert.equal(r.code, 0, r.se);
    const nomi = ricevuti.map((x) => x.url.split('/').pop());
    assert.ok(nomi.indexOf('routineSpinte') >= 0 && nomi.indexOf('routineSpinte') < nomi.indexOf('routineDeliver'), nomi.join(', '));
    const data = ricevuti.find((x) => x.url.endsWith('routineDeliver')).body.data;
    assert.equal(data.sha, c);
    assert.ok(Array.isArray(data.commits) && data.commits.some((x) => x.sha === c), JSON.stringify(data));
  } finally { srv.close(); togliCartella(casa); }
});

test('l’avvio della sessione locale mette il controllo prima della spinta nel repo e nel clone di filo-security accanto', async () => {
  const casa = cartellaTemporanea('filo-strade-avvio-');
  try {
    const app = join(casa, 'Filo');
    const server = join(casa, 'filo-security');
    mkdirSync(join(server, 'functions', 'tools'), { recursive: true });
    writeFileSync(join(server, 'functions', 'tools', 'server-fondi.js'), '\n');
    g(casa, ['init', '-q', server]);
    g(casa, ['init', '-q', app]);
    const prese = [];
    const fetchImpl = async (url, init) => {
      const { data } = JSON.parse(init.body);
      prese.push(data.op);
      return { ok: true, status: 200, json: async () => ({ result: { ok: true, ticket: `s-${'a'.repeat(40)}`, fp: 'f'.repeat(64), fiducia: 'fidato' } }) };
    };
    const r = await B.avvio({ input: { session_id: 'sess-avvio' }, env: {}, cwd: app, deps: { fetchImpl, idToken: async () => 'tok' }, haCredenziale: async () => true });
    assert.match(r.riga, /pulito/, r.riga);
    for (const dir of [app, server]) {
      const pre = join(dir, '.git', 'hooks', 'pre-push');
      assert.ok(existsSync(pre) && readFileSync(pre, 'utf8').includes(SEGNO_PRE_PUSH), `pre-push in ${dir}`);
      assert.ok(readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf8').includes(SEGNO_PRE_PUSH), `traccia in ${dir}`);
    }
    assert.match(readFileSync(join(server, '.git', 'hooks', 'pre-push'), 'utf8'), /--pre-push server/);
  } finally { togliCartella(casa); }
});

test('la chiusura del biglietto locale manda prima le spinte rimaste in coda, poi chiude', async () => {
  const dir = cartellaTemporanea('filo-strade-chiudi-');
  try {
    g(dir, ['init', '-q']);
    const ticket = `t-${'b'.repeat(40)}`;
    const fp = 'e'.repeat(64);
    const file = join(B.cartellaBiglietti(dir), 'sess-chiudi.json');
    B.scriviFile(file, { ticket, fp, natoIl: 1 });
    S.accoda(dir, { tipo: 'locale', ticket, fp, file }, 'app', [{ ramo: 'claude/x', commits: ['c'.repeat(40)] }]);
    const ops = [];
    const fetchImpl = async (url, init) => {
      const { data } = JSON.parse(init.body);
      ops.push(data.op);
      return { ok: true, status: 200, json: async () => ({ result: { ok: true } }) };
    };
    const r = await B.chiudi({ env: { CLAUDE_CODE_SESSION_ID: 'sess-chiudi' }, cwd: dir, deps: { fetchImpl, idToken: async () => 'tok', ritardoMs: 0 } });
    assert.equal(r.chiusi, 1);
    assert.deepEqual(ops.filter((o) => o === 'spinte' || o === 'chiudi'), ['spinte', 'chiudi']);
    assert.deepEqual(coda(dir), []);
  } finally { togliCartella(dir); }
});
