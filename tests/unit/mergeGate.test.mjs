// Cancello di merge (R2): l'hook auto-commit NON deve far atterrare su `main` i
// branch `worker/*` e `feature/*` (vanno solo via scripts/merge-gate.mjs), ma
// deve CONTINUARE ad auto-fondere/auto-pushare i branch normali.
//
// Questi test asseriscono il SUCCESSO della feature richiesta in R2:
//   1) una edit su un branch `worker/*` NON arriva in `main` (resta sul branch);
//   2) `merge-gate.mjs` la porta in `main`;
//   3) una edit su un branch normale viene ancora auto-pushata su `main`.
// Usano git reale in una sandbox temporanea (niente Electron, niente rete):
// l'hook gira via CLAUDE_PROJECT_DIR, merge-gate via FILO_REPO_ROOT.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(__dirname, '..', '..', '.claude', 'hooks', 'auto-commit-merge.sh');
const MERGE_GATE = resolve(__dirname, '..', '..', 'scripts', 'merge-gate.mjs');

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

// ─── logica pura del CLI (niente git) ───────────────────────────────────────

const { parseArgs, isValidBranch, runSecurityGate } = await import(
  '../../scripts/merge-gate.mjs'
);

test('parseArgs: source + target di default main', () => {
  assert.deepEqual(parseArgs(['worker/1']), { source: 'worker/1', target: 'main', dryRun: false });
});
test('parseArgs: --into e --dry-run', () => {
  assert.deepEqual(parseArgs(['worker/1.2', '--into', 'feature/1', '--dry-run']),
    { source: 'worker/1.2', target: 'feature/1', dryRun: true });
});
test('isValidBranch: accetta nomi tipici, rifiuta injection', () => {
  assert.ok(isValidBranch('worker/12'));
  assert.ok(isValidBranch('feature/12.final'));
  assert.ok(!isValidBranch('--force'));            // niente flag travestiti da branch
  assert.ok(!isValidBranch('a; rm -rf /'));        // niente metacaratteri shell
  assert.ok(!isValidBranch('a..b'));               // niente range
  assert.ok(!isValidBranch(''));
});
test('runSecurityGate è un pass-through finché R6 non lo riempie', () => {
  // R2 fornisce solo il SEAM: deve lasciar passare. R6 lo sostituirà con L4/L5.
  assert.deepEqual(runSecurityGate('diff qualsiasi', { source: 'worker/1', target: 'main' }), { ok: true });
});

const skip = !hasGit() ? 'git non disponibile' : false;

test('un branch normale viene ancora auto-pushato su main dall\'hook', { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-mg-normal-'));
  try {
    const origin = setupOrigin(base);
    const r = freshClone(base, origin, 'routine');
    git(r, ['checkout', '-q', '-b', 'claude/foo']);
    writeFileSync(join(r, 'normal.txt'), 'change on a normal branch\n');
    const out = runHook(r);
    assert.equal(out.status, 0, `hook exit 0 (stderr: ${out.stderr})`);
    assert.ok(originHasFile(origin, 'main', 'normal.txt'),
      'una edit su un branch normale deve atterrare su origin/main (auto-push invariato)');
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
    // Ma deve essere pushato sul suo branch (tracciabilità + lo prende merge-gate).
    assert.ok(originHasBranch(origin, 'worker/42'), 'il branch worker/42 deve esistere su origin');
    assert.ok(originHasFile(origin, 'worker/42', 'worker.txt'),
      'la edit deve essere committata e pushata sul branch worker/42');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('merge-gate.mjs porta il branch worker/* su main', { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-mg-gate-'));
  try {
    const origin = setupOrigin(base);
    // Una routine produce worker/7 (committato e pushato dall'hook, non su main).
    const r = freshClone(base, origin, 'routine');
    git(r, ['checkout', '-q', '-b', 'worker/7']);
    writeFileSync(join(r, 'feature.txt'), 'verified change\n');
    runHook(r);
    assert.ok(!originHasFile(origin, 'main', 'feature.txt'), 'pre-condizione: non ancora su main');

    // L'orchestratore, dopo il PASS, invoca il cancello.
    const gate = spawnSync(process.execPath, [MERGE_GATE, 'worker/7'], {
      encoding: 'utf8',
      env: { ...process.env, FILO_REPO_ROOT: r, FILO_MAIN_BRANCH: 'main' },
    });
    assert.equal(gate.status, 0, `merge-gate exit 0 (stdout: ${gate.stdout} stderr: ${gate.stderr})`);
    assert.ok(originHasFile(origin, 'main', 'feature.txt'),
      'dopo il cancello la modifica deve essere su origin/main');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('merge-gate.mjs fonde su un target diverso da main (--into feature/N)', { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-mg-into-'));
  try {
    const origin = setupOrigin(base);
    // Crea feature/9 su origin partendo da main.
    const seed = freshClone(base, origin, 'seedfeat');
    git(seed, ['checkout', '-q', '-b', 'feature/9']);
    git(seed, ['push', '-q', 'origin', 'feature/9']);

    // Un pezzo worker/9.1 con una modifica.
    const r = freshClone(base, origin, 'routine');
    git(r, ['checkout', '-q', '-b', 'worker/9.1']);
    writeFileSync(join(r, 'piece.txt'), 'piece of feature 9\n');
    runHook(r);

    const gate = spawnSync(process.execPath, [MERGE_GATE, 'worker/9.1', '--into', 'feature/9'], {
      encoding: 'utf8',
      env: { ...process.env, FILO_REPO_ROOT: r, FILO_MAIN_BRANCH: 'main' },
    });
    assert.equal(gate.status, 0, `merge-gate exit 0 (stdout: ${gate.stdout} stderr: ${gate.stderr})`);
    assert.ok(originHasFile(origin, 'feature/9', 'piece.txt'), 'il pezzo va su feature/9');
    assert.ok(!originHasFile(origin, 'main', 'piece.txt'), 'il pezzo NON deve toccare main (solo #N.final lo fa)');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
