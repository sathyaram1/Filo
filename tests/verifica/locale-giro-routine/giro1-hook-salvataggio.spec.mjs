// Prove del giro 1 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 3: l'hook di salvataggio non deve più spingere a vuoto in silenzio.
//
// Non aprono Filo: l'hook è uno script di shell che parla con git. Qui si
// costruisce un repo vero (origin nudo + una copia di lavoro + «qualcun altro»)
// e si lancia l'hook come lo lancia Claude Code, con CLAUDE_PROJECT_DIR.
// Restano nel ramo: sono la memoria di questo giro.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOK = join(ROOT, '.claude', 'hooks', 'auto-commit-merge.sh');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** origin nudo, una copia di lavoro sul ramo claude/prova, e la copia di «qualcun altro». */
function scenario(nome) {
  const base = cartellaTemporanea(`giro-routine-${nome}-`);
  const origin = join(base, 'origin.git');
  const lavoro = join(base, 'lavoro');
  const altro = join(base, 'altro');
  git(base, 'init', '-q', '--bare', origin);
  git(base, 'clone', '-q', origin, lavoro);
  git(lavoro, 'checkout', '-q', '-b', 'claude/prova');
  writeFileSync(join(lavoro, 'a.txt'), 'uno\n');
  git(lavoro, 'add', '-A');
  git(lavoro, 'commit', '-q', '-m', 'primo');
  git(lavoro, 'push', '-q', '-u', 'origin', 'claude/prova');
  git(base, 'clone', '-q', '-b', 'claude/prova', origin, altro);
  return { base, origin, lavoro, altro };
}

function hook(cwd) {
  const posix = cwd.replace(/\\/g, '/');
  const r = spawnSync('bash', [HOOK.replace(/\\/g, '/')], {
    cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: posix },
  });
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

test.describe('hook di salvataggio — la spedizione dopo un rebase e nei fallimenti', () => {
  test('dopo una storia riscritta (rebase) il ramo arriva comunque su origin', () => {
    const s = scenario('rebase');
    git(s.lavoro, 'commit', '-q', '--amend', '-m', 'primo, riscritto');
    writeFileSync(join(s.lavoro, 'b.txt'), 'due\n');
    const r = hook(s.lavoro);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/NON e' arrivato/);
    const locale = git(s.lavoro, 'rev-parse', 'HEAD');
    const remoto = git(s.origin, 'rev-parse', 'claude/prova');
    expect(remoto).toBe(locale);
    expect(git(s.lavoro, 'status', '--porcelain')).toBe('');
  });

  test('se qualcun altro ha spinto sul ramo, il rinvio non calpesta il suo lavoro e il motivo viene scritto', () => {
    const s = scenario('altri');
    writeFileSync(join(s.altro, 'c.txt'), 'tre\n');
    git(s.altro, 'add', '-A');
    git(s.altro, 'commit', '-q', '-m', 'di un altro');
    git(s.altro, 'push', '-q', 'origin', 'claude/prova');
    const diAltri = git(s.altro, 'rev-parse', 'HEAD');
    git(s.lavoro, 'commit', '-q', '--amend', '-m', 'primo, riscritto');
    writeFileSync(join(s.lavoro, 'b.txt'), 'due\n');
    const r = hook(s.lavoro);
    expect(git(s.origin, 'rev-parse', 'claude/prova')).toBe(diAltri);
    expect(r.stderr).toMatch(/NON e' arrivato su origin/);
    expect(r.stderr).toMatch(/force-with-lease/);
  });

  test('un push fallito arriva a chi lavora, non solo su stderr con uscita zero', () => {
    // Claude Code, per un hook PostToolUse che esce con 0, manda stderr al solo
    // registro di debug: né la sessione né chi guarda lo vedono. Un fallimento
    // detto lì è ancora un fallimento in silenzio. Le strade che la sessione
    // vede: un'uscita diversa da zero (la prima riga di stderr compare come
    // errore dell'hook) oppure un JSON su stdout con additionalContext.
    test.fail(true, 'rilievo aperto del giro 1: il push fallito finisce su stderr con uscita 0, che Claude Code scarta');
    const s = scenario('silenzio');
    writeFileSync(join(s.altro, 'c.txt'), 'tre\n');
    git(s.altro, 'add', '-A');
    git(s.altro, 'commit', '-q', '-m', 'di un altro');
    git(s.altro, 'push', '-q', 'origin', 'claude/prova');
    git(s.lavoro, 'commit', '-q', '--amend', '-m', 'primo, riscritto');
    writeFileSync(join(s.lavoro, 'b.txt'), 'due\n');
    const r = hook(s.lavoro);
    const visibile = r.status !== 0 || /additionalContext/.test(r.stdout);
    expect(visibile, `uscita ${r.status}, stdout: ${r.stdout.slice(0, 200)}`).toBe(true);
  });
});
