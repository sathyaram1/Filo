// Prove del giro 5 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 3: il contesto che l'hook di salvataggio manda alla sessione quando
// il problema sta in UN'ALTRA cartella di lavoro dello stesso repo.
//
// L'hook gira su tutte le cartelle di lavoro (git worktree) del repo, non solo
// su quella della sessione che ha fatto l'Edit: sulla macchina dell'owner ce
// ne sono decine, alcune di sessioni morte. Con il canale nuovo (il JSON su
// stdout) un'astensione o un push fallito di una cartella altrui arrivano
// nel contesto di QUESTA sessione, con le stesse parole di un problema suo
// («finiscilo», «sistemalo prima di consegnare»). Claude Code passa la
// cartella della sessione nello stdin dell'hook (`cwd`), quindi distinguere
// si può. Fino al 16/09/2026 questa prova DOCUMENTAVA il comportamento di
// allora; poi l'owner ha deciso: i guai delle altre cartelle si dicono come
// altrui, in una riga, mai come ordini. Da allora la prova asserisce quello.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOK = join(ROOT, '.claude', 'hooks', 'auto-commit-merge.sh');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitTenta(cwd, ...args) {
  return spawnSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
}

/** L'hook come lo lancia Claude Code dalla sessione che lavora in `mia`: stdin con evento E cartella della sessione. */
function hook(progetto, mia) {
  return spawnSync('bash', [HOOK], {
    cwd: mia, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PostToolUse', cwd: mia }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: progetto, FILO_ROUTINE: '' },
  });
}

/** Un repo con origin, la cartella principale su main, due cartelle di lavoro A e B su rami loro. */
function scenario() {
  const base = cartellaTemporanea('giro5-hook-cartelle-');
  const origin = join(base, 'origin.git');
  const principale = join(base, 'principale');
  git(base, 'init', '-q', '--bare', origin);
  git(base, 'clone', '-q', origin, principale);
  git(principale, 'config', 'core.autocrlf', 'false');
  git(principale, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(principale, 'a.txt'), 'base\n');
  git(principale, 'add', '-A');
  git(principale, 'commit', '-q', '-m', 'base');
  git(principale, 'push', '-q', '-u', 'origin', 'main');
  const A = join(principale, '.claude', 'worktrees', 'A');
  const B = join(principale, '.claude', 'worktrees', 'B');
  git(principale, 'worktree', 'add', '-q', A, '-b', 'claude/A');
  git(principale, 'worktree', 'add', '-q', B, '-b', 'claude/B');
  // B diverge da main sullo stesso file, così una fusione si ferma su un conflitto.
  writeFileSync(join(B, 'a.txt'), 'di B\n');
  git(B, 'commit', '-q', '-am', 'B');
  writeFileSync(join(principale, 'a.txt'), 'main nuovo\n');
  git(principale, 'commit', '-q', '-am', 'main nuovo');
  git(principale, 'push', '-q', 'origin', 'main');
  return { base, origin, principale, A, B };
}

test.describe('hook di salvataggio — il problema di un\'altra cartella di lavoro', () => {
  test('una fusione ferma in B arriva nel contesto della sessione che lavora in A come un guaio ALTRUI, in una riga, senza ordini', async () => {
    const s = scenario();
    const m = gitTenta(s.B, 'merge', 'main');
    expect(m.status).not.toBe(0);
    // La sessione in A fa un Edit suo, normalissimo.
    writeFileSync(join(s.A, 'a.txt'), 'lavoro di A\n');
    const r = hook(s.principale, s.A);
    expect(r.status).toBe(0);
    // Il lavoro di A è salvato e spedito, come deve.
    expect(git(s.A, 'log', '-1', '--format=%s')).toMatch(/^auto: /);
    expect(git(s.origin, 'show', 'claude/A:a.txt')).toBe('lavoro di A');
    // E su stdout, per la sessione di A, c'è l'avviso sulla cartella di B.
    expect(r.stdout).toContain('additionalContext');
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain('worktrees/B');
    expect(ctx).toMatch(/finiscilo/i);
    // Oggi niente dice che quella cartella non è di questa sessione (è il
    // rilievo del giro: se cambia, cambia anche questa riga).
    expect(ctx).not.toMatch(/altra sessione|non (è|e') (la tua|di questa sessione)/i);
  });
});
