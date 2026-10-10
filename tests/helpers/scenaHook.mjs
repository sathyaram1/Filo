// Scena delle prove degli hook di salvataggio e della guardia: repo isolato con finto origin e la copia degli hook veri,
// clone dello stesso origin (#1157), lancio dell'hook con lo stdin di Claude Code. Le cartelle si tolgono con togliScene().
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HOOKS_DIR = resolve(ROOT, '.claude', 'hooks');
// Gli automatismi che girano da soli a ogni modifica: il salvataggio e il diagnostico dei limiti di sessione. Due file,
// ma rispondono alla stessa domanda («questo ramo lo posso toccare?») e devono rispondere allo stesso modo.
export const HOOKS = ['auto-commit-merge.sh', 'cap-observe.sh'];
const fatte = [];

export function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Repo isolato con finto origin, e una copia degli hook veri da eseguire. `poison` avvelena la configurazione locale
 * di git come nello scenario reale: `push.default=upstream` + `branch.<ramo>.merge=refs/heads/main` è ciò che git
 * imposta DA SÉ su ogni ramo nato da origin/main.
 */
export function scene({ poison = false } = {}) {
  const base = cartellaTemporanea('filo-hook-');
  fatte.push(base);
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  mkdirSync(origin); mkdirSync(work);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']);
  git(work, ['remote', 'add', 'origin', origin]);
  if (poison) {
    git(work, ['config', 'push.default', 'upstream']);
    git(work, ['config', 'branch.main.merge', 'refs/heads/main']);
    git(work, ['config', 'branch.main.remote', 'origin']);
  }
  writeFileSync(resolve(work, 'README.md'), 'base\n', 'utf8');
  git(work, ['add', '-A']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base']);
  git(work, ['push', '-q', 'origin', 'main']);
  mkdirSync(resolve(work, '.claude', 'hooks'), { recursive: true });
  for (const h of HOOKS) copyFileSync(resolve(HOOKS_DIR, h), resolve(work, '.claude', 'hooks', h));
  return { base, origin, work };
}

export function togliScene() {
  for (const d of fatte.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch (_) { /* resta nella temporanea */ } }
}

// Chi lancia le prove non dichiara la sessione al posto loro: una routine si dichiara con FILO_ROUTINE=1 nella sua
// shell, e ereditata qui faceva rosso il controllo sulla provenienza per tutto il giro. Entra solo da `env`.
const ambiente = () => { const a = { ...process.env }; delete a.FILO_ROUTINE; return a; };

export function runHook(work, env = {}, hook = 'auto-commit-merge.sh', stdin = '') {
  try {
    execFileSync('bash', [resolve(work, '.claude', 'hooks', hook)], {
      cwd: work, encoding: 'utf8', input: stdin,
      env: { ...ambiente(), CLAUDE_PROJECT_DIR: work, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (_) { /* l'hook non fallisce mai per contratto */ }
}

/** Il messaggio che una sessione limitata consegna a cap-observe.sh. */
export const LIMITE = JSON.stringify({
  hook_event_name: 'StopFailure',
  error_type: 'usage_limit',
  error_message: 'session limit reached',
});

/** SHA locale di un ramo ('' se non esiste). */
export function shaOf(work, ref) {
  try { return git(work, ['rev-parse', ref]); } catch (_) { return ''; }
}

export function filesOnMain(work) {
  git(work, ['fetch', '-q', 'origin', 'main']);
  return git(work, ['ls-tree', '-r', '--name-only', 'origin/main']).split('\n').filter(Boolean);
}

export function runHookRaw(work, stdin, env = {}) {
  return spawnSync('bash', [resolve(work, '.claude', 'hooks', 'auto-commit-merge.sh')], {
    cwd: work, encoding: 'utf8', input: stdin, env: { ...ambiente(), CLAUDE_PROJECT_DIR: work, ...env },
  });
}

export function runHookAsync(work, stdin) {
  return new Promise((ok) => {
    const c = spawn('bash', [resolve(work, '.claude', 'hooks', 'auto-commit-merge.sh')], {
      cwd: work, env: { ...ambiente(), CLAUDE_PROJECT_DIR: work },
    });
    let out = ''; let err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (status) => ok({ status, stdout: out, stderr: err }));
    c.stdin.end(stdin);
  });
}

export const stdinEdit = (file, extra = {}) => JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: 'b' }, ...extra });

/** Un clone del finto origin, come lo fa scripts/lib/clone-worker.mjs: fuori dalle worktree, stesso origin. */
export function clone(origin, base, nome, ramo) {
  const dir = resolve(base, nome);
  execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'ignore' });
  git(dir, ['config', 'core.autocrlf', 'false']);
  if (ramo) git(dir, ['checkout', '-q', '-b', ramo]);
  return dir;
}

export const remoto = (dir, ramo) => git(dir, ['ls-remote', 'origin', `refs/heads/${ramo}`]).split(/\s/)[0] || '';
