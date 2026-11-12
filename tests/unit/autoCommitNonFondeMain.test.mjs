// L'hook di auto-commit NON fa atterrare niente su `main` da solo: ogni ramo resta sul suo (è il trasporto del
// lavoro), e a `main` si arriva solo dal server (`npm run finish` in locale, il cancello del server per le routine).
// Git vero in una sandbox. Spec: ROUTINE-BRANCH-INTEGRITY.md §Via 1.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(__dirname, '..', '..', '.claude', 'hooks', 'auto-commit-merge.sh');

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
  const base = cartellaTemporanea('filo-mg-normal-');
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
  } finally { togliCartella(base); }
});

test('un branch worker/* NON arriva su main, ma resta sul suo branch', { skip }, () => {
  const base = cartellaTemporanea('filo-mg-worker-');
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
  } finally { togliCartella(base); }
});
