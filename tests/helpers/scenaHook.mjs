// Scena delle prove degli hook coi clone dei worker (#1157): repo isolato con finto origin e la copia degli hook veri,
// clone dello stesso origin, lancio dell'hook con lo stdin di Claude Code. Le cartelle si tolgono con togliScene().
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HOOKS_DIR = resolve(ROOT, '.claude', 'hooks');
const HOOKS = ['auto-commit-merge.sh', 'cap-observe.sh'];
const fatte = [];

export function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function scene() {
  const base = cartellaTemporanea('filo-hook-');
  fatte.push(base);
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  mkdirSync(origin); mkdirSync(work);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']);
  git(work, ['remote', 'add', 'origin', origin]);
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

// Chi lancia le prove non dichiara la sessione al posto loro: FILO_ROUTINE entra solo da `env`.
const ambiente = () => { const a = { ...process.env }; delete a.FILO_ROUTINE; return a; };

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
