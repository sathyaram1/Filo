// Prove del giro 1 (verifica locale) sul lavoro «seguito del giro»,
// punto C: l'hook di salvataggio.
//   - quando è il COMMIT a non riuscire (index.lock a terra, pre-commit che
//     rifiuta) la sessione riceve lo stesso contesto JSON del push fallito,
//     col motivo di git dentro;
//   - i guai delle ALTRE cartelle di lavoro (un ramo altrui che origin
//     rifiuta, un index.lock altrui) si dicono come altrui, in una riga, mai
//     come ordini, riconoscendo la cartella della sessione dal campo `cwd`
//     dello stdin — anche scritto alla maniera di Windows, anche se la
//     sessione sta in una sottocartella.
// Le prove del giro 5 (locale-giro-routine) coprono già index.lock e
// pre-commit nella propria cartella e la fusione a metà altrui: qui si
// aprono le porte accanto.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOK = join(ROOT, '.claude', 'hooks', 'auto-commit-merge.sh');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** L'hook come lo lancia Claude Code: bash, stdin con evento e cartella della sessione, la cartella del progetto nell'ambiente. */
function hook(progetto, cwdSessione) {
  return spawnSync('bash', [HOOK], {
    cwd: cwdSessione, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PostToolUse', cwd: cwdSessione, tool_name: 'Edit' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: progetto, FILO_ROUTINE: '' },
  });
}

function contesto(r) {
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('additionalContext');
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
}

/**
 * Un repo con origin, la cartella principale su main, due cartelle di lavoro
 * A e B su rami loro. Origin RIFIUTA il ramo di B (un pre-receive): il ramo
 * di B non è mai stato su origin e non ci arriverà.
 */
function scenario(nome) {
  const base = cartellaTemporanea(`giro1-hook-${nome}-`);
  const origin = join(base, 'origin.git');
  const principale = join(base, 'principale');
  git(base, 'init', '-q', '--bare', origin);
  const preReceive = join(origin, 'hooks', 'pre-receive');
  writeFileSync(preReceive, '#!/bin/sh\nwhile read old new ref; do\n  case "$ref" in refs/heads/claude/B) echo "RIFIUTO-REMOTO-DI-B" >&2; exit 1;; esac\ndone\nexit 0\n');
  chmodSync(preReceive, 0o755);
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
  return { base, origin, principale, A, B };
}

const ORDINI = /sistemalo|finiscilo|prima di consegnare|rebase su origin/i;

test.describe('hook di salvataggio — il commit che non riesce, col motivo di git', () => {
  test('un pre-commit che rifiuta: il contesto porta il motivo stampato dal pre-commit, e non dice che il lavoro è committato', async () => {
    const s = scenario('precommit');
    const hooks = join(s.base, 'hooks-locali');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\necho "RIFIUTO-PRECOMMIT-4242: manca la firma" >&2\nexit 1\n');
    chmodSync(join(hooks, 'pre-commit'), 0o755);
    git(s.A, 'config', 'core.hooksPath', hooks);
    writeFileSync(join(s.A, 'a.txt'), 'modifica di A\n');
    const ctx = contesto(hook(s.principale, s.A));
    expect(git(s.A, 'log', '-1', '--format=%s')).toBe('base');
    expect(ctx).toMatch(/RIFIUTO-PRECOMMIT-4242/);
    expect(ctx).toMatch(/NON sono state committate/);
    expect(ctx).not.toMatch(/committato in locale ma NON e' su origin/);
    expect(ctx).not.toMatch(/un'altra cartella di lavoro/);
  });

  test('un index.lock a terra: il contesto lo nomina, dice che le modifiche restano nella cartella, e non dice che il lavoro è committato', async () => {
    const s = scenario('lock');
    writeFileSync(join(git(s.A, 'rev-parse', '--absolute-git-dir'), 'index.lock'), '');
    writeFileSync(join(s.A, 'a.txt'), 'modifica di A\n');
    const ctx = contesto(hook(s.principale, s.A));
    expect(git(s.A, 'log', '-1', '--format=%s')).toBe('base');
    expect(ctx).toMatch(/index\.lock/);
    expect(ctx).toMatch(/restano nella cartella/);
    expect(ctx).not.toMatch(/committato in locale ma NON e' su origin/);
  });
});

test.describe('hook di salvataggio — i guai delle altre cartelle si dicono come altrui', () => {
  for (const [forma, cwdDi] of [
    ['cwd nella forma della macchina', (p) => p],
    ['cwd con le barre normali', (p) => p.replace(/\\/g, '/')],
    ['cwd in una sottocartella della cartella di lavoro', (p) => join(p, 'sotto')],
  ]) {
    test(`il ramo di B rifiutato da origin, sessione in A (${forma}): una riga, altrui, senza ordini; A è salvata e spedita`, async () => {
      const s = scenario('altrui');
      mkdirSync(join(s.A, 'sotto'), { recursive: true });
      writeFileSync(join(s.A, 'sotto', 'mio.txt'), 'lavoro di A\n');
      writeFileSync(join(s.B, 'b.txt'), 'lavoro di B\n');
      const ctx = contesto(hook(s.principale, cwdDi(s.A)));
      // A: committata e su origin, senza avvisi su di lei.
      expect(git(s.origin, 'show', 'claude/A:sotto/mio.txt')).toBe('lavoro di A');
      // B: committata in locale, rifiutata da origin.
      expect(git(s.B, 'log', '-1', '--format=%s')).toMatch(/^auto:/);
      expect(spawnSync('git', ['rev-parse', '--verify', 'claude/B'], { cwd: s.origin, encoding: 'utf8' }).status).not.toBe(0);
      // Nel contesto: UNA riga su B, detta come altrui, col ramo e il motivo del remoto, senza ordini.
      const righe = ctx.split('\n').filter((r) => r.trim());
      const suB = righe.filter((r) => /un'altra cartella di lavoro, non la tua/.test(r));
      expect(suB).toHaveLength(1);
      expect(suB[0]).toMatch(/claude\/B/);
      expect(suB[0]).toMatch(/RIFIUTO-REMOTO-DI-B/);
      expect(suB[0]).not.toMatch(ORDINI);
      expect(ctx).not.toMatch(/committato in locale ma NON e' su origin/);
      expect(righe.filter((r) => /worktrees[\\/]A/.test(r))).toEqual([]);
    });
  }

  test('lo stesso guaio visto dalla sessione che lavora in B: è suo, con l\'ordine di spedire', async () => {
    const s = scenario('mio');
    writeFileSync(join(s.B, 'b.txt'), 'lavoro di B\n');
    const ctx = contesto(hook(s.principale, s.B));
    expect(ctx).toMatch(/claude\/B/);
    expect(ctx).toMatch(/NON e' arrivato su origin/);
    expect(ctx).toMatch(/RIFIUTO-REMOTO-DI-B/);
    expect(ctx).toMatch(/committato in locale ma NON e' su origin: sistemalo prima di consegnare/);
    expect(ctx).not.toMatch(/un'altra cartella di lavoro/);
  });

  test('un index.lock a terra in B, sessione in A: una riga altrui, senza ordini, e A è salvata e spedita', async () => {
    const s = scenario('lock-altrui');
    writeFileSync(join(git(s.B, 'rev-parse', '--absolute-git-dir'), 'index.lock'), '');
    writeFileSync(join(s.B, 'b.txt'), 'lavoro di B\n');
    writeFileSync(join(s.A, 'mio.txt'), 'lavoro di A\n');
    const ctx = contesto(hook(s.principale, s.A));
    expect(git(s.origin, 'show', 'claude/A:mio.txt')).toBe('lavoro di A');
    const suB = ctx.split('\n').filter((r) => /un'altra cartella di lavoro, non la tua/.test(r));
    expect(suB).toHaveLength(1);
    expect(suB[0]).toMatch(/index\.lock/);
    expect(suB[0]).not.toMatch(ORDINI);
    expect(ctx).not.toMatch(/si toglie/);
  });

  test('tutto a posto dappertutto: nessun contesto alla sessione', async () => {
    const s = scenario('quiete');
    writeFileSync(join(s.A, 'mio.txt'), 'lavoro di A\n');
    const r = hook(s.principale, s.A);
    expect(r.status).toBe(0);
    expect(git(s.origin, 'show', 'claude/A:mio.txt')).toBe('lavoro di A');
    expect(r.stdout.trim()).toBe('');
  });
});
