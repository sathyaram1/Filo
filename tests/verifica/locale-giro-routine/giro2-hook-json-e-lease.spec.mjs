// Prove del giro 2 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 3: quello che l'hook di salvataggio dice alla sessione quando il push
// fallisce deve essere un JSON che Claude Code legge davvero (con dentro il
// motivo di git, che su Windows porta barre rovesciate e apici), e il rinvio
// dopo un rebase non deve calpestare il lavoro di un altro nemmeno quando la
// copia ha fatto un fetch nel frattempo.

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

function scenario(nome) {
  const base = cartellaTemporanea(`giro2-hook-${nome}-`);
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

/** L'hook come lo lancia Claude Code: CLAUDE_PROJECT_DIR e il JSON dell'evento su stdin. */
function hook(cwd, stdin = '') {
  const posix = cwd.replace(/\\/g, '/');
  const r = spawnSync('bash', [HOOK.replace(/\\/g, '/')], {
    cwd, encoding: 'utf8', input: stdin, env: { ...process.env, CLAUDE_PROJECT_DIR: posix },
  });
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

test.describe('hook di salvataggio — il fallimento arriva in una forma che la sessione legge', () => {
  test('con origin irraggiungibile (percorso di Windows, con barre rovesciate) il contesto è un JSON valido con dentro il motivo', () => {
    const s = scenario('json');
    // Un remoto che non esiste, con le virgolette nel nome: il messaggio di
    // git lo ripete tale e quale, e dentro un JSON una virgolette non
    // scappata lo rompe (con le barre rovesciate git legge «C:» come un host
    // ssh e non ripete il percorso: provato).
    const rotto = 'C:/non/esiste/origin "virgolette".git';
    git(s.lavoro, 'remote', 'set-url', 'origin', rotto);
    writeFileSync(join(s.lavoro, 'b.txt'), 'due\n');
    const r = hook(s.lavoro, JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit' }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim(), `stdout: ${r.stdout}`).not.toBe('');
    let json;
    expect(() => { json = JSON.parse(r.stdout); }, `non è JSON: ${r.stdout}`).not.toThrow();
    expect(json.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    const ctx = json.hookSpecificOutput.additionalContext;
    expect(ctx).toMatch(/SALVATAGGIO/);
    expect(ctx).toMatch(/NON e' arrivato su origin/);
    expect(ctx).toMatch(/"virgolette"/);
    expect(ctx).toMatch(/NON e' su origin/);
    // Il commit locale c'è comunque: il paracadute non dipende dal push.
    expect(git(s.lavoro, 'status', '--porcelain')).toBe('');
    expect(git(s.lavoro, 'log', '-1', '--format=%s')).toMatch(/^auto: b\.txt/);
  });

  test('quando tutto arriva su origin, stdout resta vuoto (niente contesto a ogni Edit)', () => {
    const s = scenario('muto');
    writeFileSync(join(s.lavoro, 'b.txt'), 'due\n');
    const r = hook(s.lavoro, JSON.stringify({ hook_event_name: 'PostToolUse' }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
    expect(git(s.origin, 'rev-parse', 'claude/prova')).toBe(git(s.lavoro, 'rev-parse', 'HEAD'));
  });

  test('lanciato da un terminale senza JSON su stdin non resta appeso e non cambia comportamento', () => {
    const s = scenario('stdin-vuoto');
    writeFileSync(join(s.lavoro, 'b.txt'), 'due\n');
    const r = hook(s.lavoro, '');
    expect(r.status).toBe(0);
    expect(git(s.origin, 'rev-parse', 'claude/prova')).toBe(git(s.lavoro, 'rev-parse', 'HEAD'));
  });
});

test.describe('hook di salvataggio — il rinvio dopo un rebase e il lavoro degli altri', () => {
  test('se un altro ha spinto E questa copia lo ha già scaricato con un fetch, il rinvio NON calpesta il suo commit', () => {
    // --force-with-lease, senza un valore atteso, si fida del ref remoto che
    // la copia conosce: dopo un `git fetch` quel ref è già quello dell'altro,
    // il lease «combacia» e il rinvio riscrive la storia sopra al suo lavoro.
    // Rilievo del giro 2, situazione rara (due che scrivono sullo stesso ramo
    // e un fetch in mezzo): livello 0, lasciato all'owner.
    test.fail(true, 'rilievo del giro 2: dopo un fetch il lease combacia col commit dell’altro e il rinvio lo sovrascrive');
    const s = scenario('fetch');
    writeFileSync(join(s.altro, 'c.txt'), 'tre\n');
    git(s.altro, 'add', '-A');
    git(s.altro, 'commit', '-q', '-m', 'di un altro');
    git(s.altro, 'push', '-q', 'origin', 'claude/prova');
    const diAltri = git(s.altro, 'rev-parse', 'HEAD');
    git(s.lavoro, 'fetch', '-q', 'origin');
    git(s.lavoro, 'commit', '-q', '--amend', '-m', 'primo, riscritto');
    writeFileSync(join(s.lavoro, 'b.txt'), 'due\n');
    hook(s.lavoro, JSON.stringify({ hook_event_name: 'PostToolUse' }));
    const suOrigin = git(s.origin, 'rev-parse', 'claude/prova');
    const contiene = spawnSync('git', ['merge-base', '--is-ancestor', diAltri, suOrigin], { cwd: s.origin }).status === 0;
    expect(contiene, `origin è a ${suOrigin}, il commit dell'altro (${diAltri}) non c'è più`).toBe(true);
  });
});
