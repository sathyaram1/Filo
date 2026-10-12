// Verifica #1108 giro 1, rilievo 1: una copia dei feedback salvata nel repo con un nome qualunque (non «dump»)
// viene committata e spedita dal salvataggio automatico; la sentinella la vede solo dopo, quando è già nella storia.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOK = join(ROOT, '.claude', 'hooks', 'auto-commit-merge.sh');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function scenario() {
  const base = cartellaTemporanea('verifica-1108-');
  const origin = join(base, 'origin.git');
  const lavoro = join(base, 'lavoro');
  git(base, 'init', '-q', '--bare', origin);
  git(base, 'clone', '-q', origin, lavoro);
  git(lavoro, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(lavoro, '.gitignore'), execFileSync('git', ['show', 'HEAD:.gitignore'], { cwd: ROOT, encoding: 'utf8' }));
  writeFileSync(join(lavoro, 'a.txt'), 'base\n');
  git(lavoro, 'add', '-A');
  git(lavoro, 'commit', '-q', '-m', 'base');
  git(lavoro, 'push', '-q', '-u', 'origin', 'main');
  git(lavoro, 'checkout', '-q', '-b', 'claude/prova');
  git(lavoro, 'push', '-q', '-u', 'origin', 'claude/prova');
  return { origin, lavoro };
}

const COPIA = {
  documents: [{
    name: 'projects/filo/databases/(default)/documents/feedback/abc123',
    fields: { text: { stringValue: 'il tasto non va' }, userAgent: { stringValue: 'Mozilla/5.0' }, clientId: { stringValue: 'c-1' } },
  }],
};

test('r1 una copia dei feedback salvata nel repo con un nome qualunque non arriva su origin', () => {
  const s = scenario();
  mkdirSync(join(s.lavoro, 'scripts'));
  writeFileSync(join(s.lavoro, 'scripts', 'feedback.json'), JSON.stringify(COPIA, null, 2));
  writeFileSync(join(s.lavoro, 'a.txt'), 'lavoro\n');
  const r = spawnSync('bash', [HOOK], {
    cwd: s.lavoro, encoding: 'utf8', input: '{"hook_event_name":"PostToolUse"}',
    env: { ...process.env, CLAUDE_PROJECT_DIR: s.lavoro, FILO_ROUTINE: '1' },
  });
  expect(r.status).toBe(0);
  // Il salvataggio normale deve restare: la modifica ad a.txt arriva.
  expect(git(s.origin, 'show', 'claude/prova:a.txt')).toBe('lavoro');
  // La copia no: una volta su origin (pubblico) resta nella storia anche se tolta subito.
  const suOrigin = git(s.origin, 'ls-tree', '-r', '--name-only', 'claude/prova').split('\n');
  expect(suOrigin).not.toContain('scripts/feedback.json');
});
