// La scena delle prove degli agganci di salvataggio (tests/unit/autoCommitGate*.test.mjs): un repo con un finto
// origin e la copia degli hook veri. Le prove stanno in più file perché girino in parallelo, ciascuno lontano dal tetto
// di tempo per file (#1063); il repo di partenza si costruisce una volta per processo e si copia.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './percorsi.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HOOKS_DIR = resolve(ROOT, '.claude', 'hooks');
// Gli automatismi che girano da soli a ogni modifica: il salvataggio e il diagnostico dei limiti di sessione.
// Rispondono entrambi alla stessa domanda, «questo ramo lo posso toccare?», e devono rispondere allo stesso modo.
export const HOOKS = ['auto-commit-merge.sh', 'cap-observe.sh'];

export function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let modello = null;
function repoDiPartenza() {
  if (modello) return modello;
  const base = cartellaTemporanea('filo-hook-modello-');
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
  modello = base;
  return base;
}

/**
 * Repo isolato con finto origin (main con un commit, già spedito), e una copia degli hook veri da eseguire.
 * `poison` avvelena la configurazione locale di git come nello scenario reale: `push.default=upstream` +
 * `branch.<ramo>.merge=refs/heads/main` è ciò che git imposta DA SÉ su ogni ramo nato da origin/main.
 */
export function scene({ poison = false } = {}) {
  const base = cartellaTemporanea('filo-hook-');
  cpSync(repoDiPartenza(), base, { recursive: true });
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  git(work, ['remote', 'set-url', 'origin', origin]);
  if (poison) {
    git(work, ['config', 'push.default', 'upstream']);
    git(work, ['config', 'branch.main.merge', 'refs/heads/main']);
    git(work, ['config', 'branch.main.remote', 'origin']);
  }
  mkdirSync(resolve(work, '.claude', 'hooks'), { recursive: true });
  for (const h of HOOKS) copyFileSync(resolve(HOOKS_DIR, h), resolve(work, '.claude', 'hooks', h));
  return { base, origin, work };
}

// Chi lancia i test NON deve poter dichiarare la sessione al posto del test: una routine si dichiara con FILO_ROUTINE=1
// nella sua shell, e ereditata faceva dei due autori lo stesso. La dichiarazione entra solo da `env`.
function ambienteDelTest(work, env = {}) {
  const ambiente = { ...process.env };
  delete ambiente.FILO_ROUTINE;
  return { ...ambiente, CLAUDE_PROJECT_DIR: work, ...env };
}

export function runHook(work, env = {}, hook = 'auto-commit-merge.sh', stdin = '') {
  try {
    execFileSync('bash', [resolve(work, '.claude', 'hooks', hook)], {
      cwd: work, encoding: 'utf8', input: stdin, env: ambienteDelTest(work, env), stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (_) { /* l'hook non fallisce mai per contratto */ }
}

/** Come runHook, ma restituisce lo stderr: è lì che l'hook deve parlare. */
export function runHookStderr(work, env = {}) {
  const r = spawnSync('bash', [resolve(work, '.claude', 'hooks', 'auto-commit-merge.sh')], {
    cwd: work, encoding: 'utf8', input: '', env: ambienteDelTest(work, env),
  });
  return String(r.stderr || '');
}

/** L'esito intero dell'hook di salvataggio, con lo stdin dato. */
export function runHookRaw(work, stdin) {
  return spawnSync('bash', [resolve(work, '.claude', 'hooks', 'auto-commit-merge.sh')], {
    cwd: work, encoding: 'utf8', input: stdin, env: ambienteDelTest(work),
  });
}

export const rigaJson = (r) => String(r.stdout || '').split(/\r?\n/).find((l) => l.trim().startsWith('{'));

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

/** Commit di un file col nome dato, sul ramo corrente (solo quello: con `add -A` finivano nel commit anche gli hook
 * copiati, e un `reset --hard` dopo li cancellava). */
export function commitFile(work, name, content = 'x\n') {
  writeFileSync(resolve(work, name), content, 'utf8');
  git(work, ['add', name]);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', name]);
}
