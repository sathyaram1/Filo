// Prove del giro 4 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 3: l'hook di salvataggio quando è il SERVER remoto a rifiutare il push
// (un pre-receive: la forma della protezione del repo su GitHub, delle regole
// sui contenuti, del push protection sui segreti), col messaggio del remoto
// dentro — con ritorni a capo, virgolette e tab, come arrivano davvero. Il
// contesto per la sessione deve restare un JSON valido e portare quel
// messaggio. E si guarda cosa sente la sessione quando l'hook si astiene a
// metà di una fusione.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
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

/** L'hook, come lo lancia Claude Code: bash, stdin col nome dell'evento, la cartella del progetto nell'ambiente. */
function hook(lavoro) {
  return spawnSync('bash', [HOOK], {
    cwd: lavoro, encoding: 'utf8', input: '{"hook_event_name":"PostToolUse"}',
    env: { ...process.env, CLAUDE_PROJECT_DIR: lavoro, FILO_ROUTINE: '1' },
  });
}

function scenario(nome) {
  const base = cartellaTemporanea(`giro4-hook-${nome}-`);
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

/** Da qui in poi origin rifiuta ogni push con un messaggio a più righe, virgolette e tab. */
function originRifiuta(s) {
  const f = join(s.origin, 'hooks', 'pre-receive');
  writeFileSync(f, '#!/bin/sh\nprintf "GH013: push declined due to repository rule violations\\r\\nsecondo \\"motivo\\" con\\ttab\\n" >&2\nexit 1\n');
  chmodSync(f, 0o755);
}

test.describe('hook di salvataggio — il rifiuto viene dal server remoto', () => {
  test('il contesto per la sessione resta un JSON valido e porta il messaggio del remoto (ritorni a capo, virgolette, tab compresi)', async () => {
    const s = scenario('json');
    originRifiuta(s);
    writeFileSync(join(s.lavoro, 'a.txt'), 'modifica\n');
    const r = hook(s.lavoro);
    expect(r.status).toBe(0);
    // Committato in locale, non arrivato su origin.
    expect(git(s.lavoro, 'log', '-1', '--format=%s')).toMatch(/^auto: /);
    expect(git(s.origin, 'show', 'claude/prova:a.txt')).toBe('mio');
    expect(r.stdout.trim()).not.toBe('');
    let json;
    expect(() => { json = JSON.parse(r.stdout); }).not.toThrow();
    const ctx = json.hookSpecificOutput.additionalContext;
    expect(json.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(ctx).toContain('NON e\' arrivato su origin');
    expect(ctx).toContain('GH013');
    expect(ctx).toContain('secondo "motivo"');
  });

  test('un rifiuto del remoto (regola del repo) non viene raccontato come «storia divergente, qualcun altro ha spinto»', async () => {
    test.fail(true, 'giro 4: la parola «rejected» nel messaggio di git fa scattare la diagnosi di storia divergente anche quando è il remoto a rifiutare per una regola');
    const s = scenario('diagnosi');
    originRifiuta(s);
    writeFileSync(join(s.lavoro, 'a.txt'), 'modifica\n');
    const r = hook(s.lavoro);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).not.toMatch(/storia divergente/i);
    expect(ctx).not.toMatch(/qualcun altro ha spinto/i);
  });
});

test.describe('hook di salvataggio — a metà di una fusione la sessione lo viene a sapere', () => {
  test('quando si astiene per un conflitto in corso lo dice ANCHE alla sessione, non solo al registro di debug', async () => {
    test.fail(true, 'giro 4: l\'astensione durante un rebase o una fusione va solo su stderr con uscita 0, che Claude Code non mostra alla sessione');
    const s = scenario('astensione');
    git(s.lavoro, 'checkout', '-q', 'main');
    writeFileSync(join(s.lavoro, 'a.txt'), 'loro\n');
    git(s.lavoro, 'commit', '-q', '-am', 'loro');
    git(s.lavoro, 'checkout', '-q', 'claude/prova');
    const m = gitTenta(s.lavoro, 'merge', 'main');
    expect(m.status).not.toBe(0);
    writeFileSync(join(s.lavoro, 'a.txt'), 'risolto\n');
    const r = hook(s.lavoro);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/NON committo/);
    const json = JSON.parse(r.stdout || '{}');
    expect(json.hookSpecificOutput?.additionalContext || '').toMatch(/fusione|rebase/i);
  });
});
