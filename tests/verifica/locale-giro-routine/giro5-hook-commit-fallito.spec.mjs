// Prove del giro 5 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 3: «l'hook di salvataggio non deve più spingere a vuoto in silenzio».
// I giri 1-4 hanno chiuso il push fallito; qui si prova il passo PRIMA del
// push: quando è il COMMIT a non riuscire. Due forme vere:
//   - un `index.lock` rimasto a terra (un git ucciso a metà — Claude Code
//     ammazza i comandi che sforano il tempo — ne lascia uno): da lì in poi
//     ogni `git add` fallisce, e finché qualcuno non lo toglie non si salva
//     più niente;
//   - un pre-commit che rifiuta (core.hooksPath).
// In tutti e due i casi l'hook esce 0, non committa, non spedisce, e su stdout
// non c'è niente: la sessione crede di essere salvata e non lo è. Il rilascio
// del biglietto lo scoprirebbe a fine lavoro (commitRestante si ferma), ma il
// paracadute a ogni Edit — il motivo per cui l'hook esiste — è spento in
// silenzio per tutta la sessione.

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

/** L'hook, come lo lancia Claude Code: bash, stdin col nome dell'evento, la cartella del progetto nell'ambiente. */
function hook(lavoro) {
  return spawnSync('bash', [HOOK], {
    cwd: lavoro, encoding: 'utf8', input: '{"hook_event_name":"PostToolUse"}',
    env: { ...process.env, CLAUDE_PROJECT_DIR: lavoro, FILO_ROUTINE: '1' },
  });
}

function scenario(nome) {
  const base = cartellaTemporanea(`giro5-hook-commit-${nome}-`);
  const origin = join(base, 'origin.git');
  const lavoro = join(base, 'lavoro');
  git(base, 'init', '-q', '--bare', origin);
  git(base, 'clone', '-q', origin, lavoro);
  git(lavoro, 'config', 'core.autocrlf', 'false');
  git(lavoro, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(lavoro, 'a.txt'), 'base\n');
  git(lavoro, 'add', '-A');
  git(lavoro, 'commit', '-q', '-m', 'base');
  git(lavoro, 'push', '-q', '-u', 'origin', 'main');
  git(lavoro, 'checkout', '-q', '-b', 'claude/prova');
  writeFileSync(join(lavoro, 'a.txt'), 'mio\n');
  git(lavoro, 'commit', '-q', '-am', 'mio');
  git(lavoro, 'push', '-q', '-u', 'origin', 'claude/prova');
  return { base, origin, lavoro };
}

test.describe('hook di salvataggio — quando è il commit a non riuscire', () => {
  test('con un index.lock rimasto a terra il salvataggio non avviene, e la sessione lo viene a sapere', async () => {
    const s = scenario('lock');
    const gitDir = git(s.lavoro, 'rev-parse', '--absolute-git-dir');
    writeFileSync(join(gitDir, 'index.lock'), '');
    writeFileSync(join(s.lavoro, 'a.txt'), 'modifica non salvata\n');
    const r = hook(s.lavoro);
    expect(r.status).toBe(0);
    // Niente è stato salvato: HEAD è ancora «mio», la modifica è solo nel file.
    expect(git(s.lavoro, 'log', '-1', '--format=%s')).toBe('mio');
    expect(git(s.origin, 'show', 'claude/prova:a.txt')).toBe('mio');
    // Il punto: la sessione deve saperlo, dallo stesso canale del push fallito.
    expect(r.stdout).toContain('additionalContext');
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toMatch(/index\.lock|commit/i);
  });

  test('con un pre-commit che rifiuta il commit non nasce, e la sessione lo viene a sapere', async () => {
    const s = scenario('precommit');
    const hooks = join(s.base, 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\necho "pre-commit: no" >&2\nexit 1\n');
    chmodSync(join(hooks, 'pre-commit'), 0o755);
    git(s.lavoro, 'config', 'core.hooksPath', hooks);
    writeFileSync(join(s.lavoro, 'a.txt'), 'modifica non salvata\n');
    const r = hook(s.lavoro);
    expect(r.status).toBe(0);
    expect(git(s.lavoro, 'log', '-1', '--format=%s')).toBe('mio');
    expect(git(s.origin, 'show', 'claude/prova:a.txt')).toBe('mio');
    expect(r.stdout).toContain('additionalContext');
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toMatch(/pre-commit|commit/i);
  });
});
