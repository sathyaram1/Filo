// Il cancello di merge, dopo il trasloco sul server (SPEC-RIDISEGNO-MAX.md §10).
//
// Due cose da sorvegliare, e sono diverse:
//
//   1) L'HOOK di auto-commit NON fa atterrare niente su `main` da solo: ogni
//      branch resta sul suo ramo (è il trasporto del lavoro), e a `main` ci si
//      arriva SOLO dal cancello. Questi test usano git vero in una sandbox.
//   2) `merge-gate.mjs` è diventato il CLIENT del canale: presenta il biglietto
//      e chiede al SERVER di fondere. Qui non gira più nessun git e nessun L5
//      locale (la copia viva di L5 è sul server, filo-security): si testa il
//      contratto — biglietto + branch nel corpo, NIENT'ALTRO (nessun verdetto
//      raccontato) — e la mappa risposta → exit code, che è il contratto CLI
//      su cui il ruolo secaudit decide le chiusure:
//        0 fuso · 10 bloccato (L5) · 20 conflitto · 1 errore/rifiuto.
//      Server finto via FILO_ROUTINE_API, come in routineChain.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(__dirname, '..', '..', '.claude', 'hooks', 'auto-commit-merge.sh');
const MERGE_GATE = resolve(__dirname, '..', '..', 'scripts', 'merge-gate.mjs');

// ─── logica pura del CLI (niente git, niente rete) ───────────────────────────

const { parseArgs, isValidBranch, exitCodeFor } = await import('../../scripts/merge-gate.mjs');

test('parseArgs: solo il source; qualunque flag è sconosciuto', () => {
  assert.deepEqual(parseArgs(['worker/1']), { source: 'worker/1', unknown: [] });
  // I vecchi flag non passano in silenzio: --into era il Modello B (abolito),
  // --dry-run era il merge locale (sparito col trasloco sul server).
  assert.ok(parseArgs(['worker/1', '--into', 'feature/1']).unknown.includes('--into'));
  assert.ok(parseArgs(['worker/1', '--dry-run']).unknown.includes('--dry-run'));
});

test('isValidBranch: accetta nomi tipici, rifiuta injection', () => {
  assert.ok(isValidBranch('worker/12'));
  assert.ok(isValidBranch('feature/12.final'));
  assert.ok(!isValidBranch('--force'));            // niente flag travestiti da branch
  assert.ok(!isValidBranch('a; rm -rf /'));        // niente metacaratteri shell
  assert.ok(!isValidBranch('a..b'));               // niente range
  assert.ok(!isValidBranch(''));
});

test('exitCodeFor: il contratto CLI su cui il ruolo secaudit decide le chiusure', () => {
  assert.equal(exitCodeFor({ ok: true, result: 'merged', sha: 'abc' }), 0);
  assert.equal(exitCodeFor({ ok: true, result: 'blocked', reason: 'guard_the_guards: firestore.rules' }), 10);
  assert.equal(exitCodeFor({ ok: true, result: 'conflict' }), 20);
  // Un RIFIUTO del server (verdetti non registrati, ramo che non combacia,
  // biglietto morto) è 1, non 10: non è un blocco di sicurezza da spiegare
  // all'owner, è una richiesta fuori perimetro già registrata dal server.
  assert.equal(exitCodeFor({ ok: false, reason: 'not_approved' }), 1);
  assert.equal(exitCodeFor({ ok: false, reason: 'branch_mismatch' }), 1);
  assert.equal(exitCodeFor({ ok: false, reason: 'github_unreachable' }), 1);
  // Risposte malformate: mai un finto successo.
  assert.equal(exitCodeFor({}), 1);
  assert.equal(exitCodeFor(null), 1);
  assert.equal(exitCodeFor({ ok: true }), 1);
});

// ─── il client contro un server finto ─────────────────────────────────────────

/** Server finto: risponde a /routineMerge e cattura cosa gli arriva. */
function fintoServer(risposta, status = 200) {
  const richieste = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      richieste.push({ url: req.url, body: body ? JSON.parse(body) : {} });
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = status;
      res.end(JSON.stringify(risposta));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, richieste, port: srv.address().port })));
}

/** Lancia il CLI vero contro il server finto, col biglietto in env. */
function gate(port, args, { ticket = 'biglietto-di-prova' } = {}) {
  const casa = mkdtempSync(join(tmpdir(), 'filo-mg-client-'));
  try {
    const env = {
      ...process.env,
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
      FILO_REPO_ROOT: casa, // il biglietto si cerca qui: cartella pulita
    };
    if (ticket) env.FILO_ROUTINE_TICKET = ticket;
    else delete env.FILO_ROUTINE_TICKET;
    return spawnSync(process.execPath, [MERGE_GATE, ...args], { encoding: 'utf8', env });
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
}

test('merged → exit 0, e al server arrivano SOLO biglietto e branch', async () => {
  const { srv, richieste, port } = await fintoServer({ ok: true, result: 'merged', sha: 'abc123def456' });
  try {
    const r = gate(port, ['worker/7']);
    assert.equal(r.status, 0, `exit 0 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stdout, /fuso su main dal server/);
    assert.equal(richieste.length, 1);
    assert.ok(richieste[0].url.endsWith('/routineMerge'));
    // Il contratto che chiude il buco: nessun verdetto viaggia nel corpo. Se
    // un giorno qualcuno reinfilasse un FILO_L4_VERDICT, questo diventa rosso.
    assert.deepEqual(Object.keys(richieste[0].body).sort(), ['branch', 'ticket']);
    assert.equal(richieste[0].body.ticket, 'biglietto-di-prova');
    assert.equal(richieste[0].body.branch, 'worker/7');
  } finally { srv.close(); }
});

test('blocked (L5 sul server) → exit 10, col motivo del blocco', async () => {
  const { srv, port } = await fintoServer({ ok: true, result: 'blocked', reason: 'guard_the_guards: firestore.rules' });
  try {
    const r = gate(port, ['worker/13']);
    assert.equal(r.status, 10, `exit 10 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stderr, /BLOCKED/);
    assert.match(r.stderr, /firestore\.rules/);
  } finally { srv.close(); }
});

test('conflict → exit 20', async () => {
  const { srv, port } = await fintoServer({ ok: true, result: 'conflict', reason: 'conflitto di merge: serve risoluzione manuale' });
  try {
    const r = gate(port, ['worker/9']);
    assert.equal(r.status, 20, `exit 20 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stderr, /CONFLICT/);
  } finally { srv.close(); }
});

test('rifiuto del server (verdetti non registrati) → exit 1, col motivo', async () => {
  const { srv, port } = await fintoServer({ ok: false, reason: 'not_approved' }, 401);
  try {
    const r = gate(port, ['worker/11']);
    assert.equal(r.status, 1, `exit 1 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stderr, /not_approved/);
  } finally { srv.close(); }
});

test('senza biglietto → exit 1 SENZA nemmeno chiamare il server', async () => {
  const { srv, richieste, port } = await fintoServer({ ok: true, result: 'merged' });
  try {
    const r = gate(port, ['worker/7'], { ticket: '' });
    assert.equal(r.status, 1, `exit 1 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stderr, /biglietto/);
    assert.equal(richieste.length, 0, 'senza biglietto non c’è niente da chiedere');
  } finally { srv.close(); }
});

test('il vecchio --into viene rifiutato prima di qualunque chiamata', async () => {
  const { srv, richieste, port } = await fintoServer({ ok: true, result: 'merged' });
  try {
    const r = gate(port, ['worker/9.1', '--into', 'feature/9']);
    assert.equal(r.status, 1, `exit 1 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stderr, /--into/);
    assert.equal(richieste.length, 0);
  } finally { srv.close(); }
});

test('branch con injection → exit 1 senza chiamate', async () => {
  const { srv, richieste, port } = await fintoServer({ ok: true, result: 'merged' });
  try {
    const r = gate(port, ['a;rm -rf /']);
    assert.equal(r.status, 1);
    assert.equal(richieste.length, 0);
  } finally { srv.close(); }
});

// ─── l'hook: nessun branch arriva su main da solo (git vero, sandbox) ─────────

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// Esegue l'hook come fa Claude Code: bash con CLAUDE_PROJECT_DIR = dir corrente.
function runHook(dir) {
  return spawnSync('bash', [HOOK], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, FILO_MAIN_BRANCH: 'main' },
  });
}

// Il commit sull'origin (bare) per <branch> contiene <file>?
function originHasFile(origin, branch, file) {
  const r = spawnSync('git', ['--git-dir=' + origin, 'ls-tree', '-r', '--name-only', branch], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.split('\n').includes(file);
}

// L'origin (bare) ha il ref di branch?
function originHasBranch(origin, branch) {
  const r = spawnSync('git', ['--git-dir=' + origin, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  return r.status === 0;
}

function setupOrigin(base) {
  const origin = join(base, 'origin.git');
  const seed = join(base, 'seed');
  git(base, ['init', '--bare', '-b', 'main', origin]);
  git(base, ['clone', '-q', origin, seed]);
  git(seed, ['config', 'user.email', 't@t']); git(seed, ['config', 'user.name', 't']);
  writeFileSync(join(seed, 'README.md'), 'seed\n');
  git(seed, ['add', '-A']); git(seed, ['commit', '-q', '-m', 'seed']); git(seed, ['push', '-q', 'origin', 'main']);
  return origin;
}

function freshClone(base, origin, name) {
  const dir = join(base, name);
  git(base, ['clone', '-q', origin, dir]);
  git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']);
  return dir;
}

const skip = !hasGit() ? 'git non disponibile' : false;

// ⚠️ Questo test asseriva l'OPPOSTO fino al 2026-08-07 ("un branch normale
// viene ancora auto-pushato su main"): era il comportamento che permetteva a
// un'istanza su un branch dal nome qualsiasi di pubblicare senza passare dal
// cancello. Ora nessun branch di lavoro raggiunge main da solo — ci si arriva
// una volta sola, a lavoro finito (`npm run finish` / il cancello sul server).
// Spec: ROUTINE-BRANCH-INTEGRITY.md §Via 1.
test('nessun branch di lavoro arriva su main da solo, nemmeno con un nome qualsiasi', { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-mg-normal-'));
  try {
    const origin = setupOrigin(base);
    const r = freshClone(base, origin, 'routine');
    git(r, ['checkout', '-q', '-b', 'claude/foo']);
    writeFileSync(join(r, 'normal.txt'), 'change on a normal branch\n');
    const out = runHook(r);
    assert.equal(out.status, 0, `hook exit 0 (stderr: ${out.stderr})`);
    assert.ok(!originHasFile(origin, 'main', 'normal.txt'),
      'una modifica in corso non deve raggiungere main: da lì viene distribuita agli utenti ogni 6 ore');
    assert.ok(originHasFile(origin, 'claude/foo', 'normal.txt'),
      'ma deve essere al sicuro sul suo branch: è ciò che salva il lavoro se la sessione si interrompe');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('un branch worker/* NON arriva su main, ma resta sul suo branch', { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-mg-worker-'));
  try {
    const origin = setupOrigin(base);
    const r = freshClone(base, origin, 'routine');
    git(r, ['checkout', '-q', '-b', 'worker/42']);
    writeFileSync(join(r, 'worker.txt'), 'unverified change\n');
    const out = runHook(r);
    assert.equal(out.status, 0, `hook exit 0 (stderr: ${out.stderr})`);
    // Il cancello: NON deve toccare main.
    assert.ok(!originHasFile(origin, 'main', 'worker.txt'),
      'una edit su worker/* NON deve atterrare su main senza passare dal cancello');
    // Ma deve essere pushato sul suo branch (tracciabilità + lo vede il server).
    assert.ok(originHasBranch(origin, 'worker/42'), 'il branch worker/42 deve esistere su origin');
    assert.ok(originHasFile(origin, 'worker/42', 'worker.txt'),
      'la edit deve essere committata e pushata sul branch worker/42');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
