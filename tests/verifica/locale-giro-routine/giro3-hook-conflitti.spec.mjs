// Prove del giro 3 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 3: l'hook di salvataggio nelle situazioni che il lavoro stesso ora
// provoca. Il contesto che l'hook manda alla sessione quando il push fallisce
// dice «un rebase su origin e poi il push»: e durante quel rebase, a ogni Edit
// con cui l'agente risolve un conflitto, l'hook riparte. Qui si guarda cosa
// committa e cosa spedisce in quel momento, e su un ramo che origin non ha
// ancora mai visto.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOK = join(ROOT, '.claude', 'hooks', 'auto-commit-merge.sh');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Il comando di git che PUÒ fallire (un merge o un rebase fermo su un conflitto). */
function gitTenta(cwd, ...args) {
  return spawnSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
}

/** origin nudo, main con «base», e un ramo di lavoro spedito su origin. */
function scenario(nome) {
  const base = cartellaTemporanea(`giro3-hook-${nome}-`);
  const origin = join(base, 'origin.git');
  const lavoro = join(base, 'lavoro');
  git(base, 'init', '-q', '--bare', origin);
  git(base, 'clone', '-q', origin, lavoro);
  git(lavoro, 'config', 'core.autocrlf', 'false');
  git(lavoro, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(lavoro, 'a.txt'), 'base\n');
  writeFileSync(join(lavoro, 'b.txt'), 'base\n');
  git(lavoro, 'add', '-A');
  git(lavoro, 'commit', '-q', '-m', 'base');
  git(lavoro, 'push', '-q', '-u', 'origin', 'main');
  git(lavoro, 'checkout', '-q', '-b', 'claude/prova');
  writeFileSync(join(lavoro, 'a.txt'), 'mio\n');
  writeFileSync(join(lavoro, 'b.txt'), 'mio\n');
  git(lavoro, 'commit', '-q', '-am', 'mio');
  git(lavoro, 'push', '-q', '-u', 'origin', 'claude/prova');
  return { base, origin, lavoro };
}

/** Su main entra «loro» sugli stessi due file: il ramo di lavoro ora è in conflitto con main. */
function mainDiverge(s) {
  git(s.lavoro, 'checkout', '-q', 'main');
  writeFileSync(join(s.lavoro, 'a.txt'), 'loro\n');
  writeFileSync(join(s.lavoro, 'b.txt'), 'loro\n');
  git(s.lavoro, 'commit', '-q', '-am', 'loro');
  git(s.lavoro, 'push', '-q', 'origin', 'main');
  git(s.lavoro, 'checkout', '-q', 'claude/prova');
}

/** L'hook come lo lancia Claude Code: CLAUDE_PROJECT_DIR e il JSON dell'evento su stdin. */
function hook(cwd) {
  const posix = cwd.replace(/\\/g, '/');
  const r = spawnSync('bash', [HOOK.replace(/\\/g, '/')], {
    cwd, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: posix },
  });
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

const SEGNI = /^<{7}|^={7}$|^>{7}/m;

test.describe('hook di salvataggio — un ramo che origin non ha mai visto', () => {
  test('la prima modifica su un ramo nuovo lo fa nascere anche su origin', () => {
    const s = scenario('nuovo');
    git(s.lavoro, 'checkout', '-q', '-b', 'claude/nuovissimo');
    writeFileSync(join(s.lavoro, 'c.txt'), 'tre\n');
    const r = hook(s.lavoro);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
    expect(git(s.origin, 'rev-parse', 'claude/nuovissimo')).toBe(git(s.lavoro, 'rev-parse', 'HEAD'));
  });
});

test.describe('hook di salvataggio — nel mezzo di un conflitto', () => {
  test('durante un rebase fermo su un conflitto, un Edit non fa committare i segni di conflitto né sparire il commit in corso', () => {
    // Il contesto dell'hook dice all'agente «un rebase su origin e poi il
    // push». Il rebase si ferma su a.txt e b.txt; l'agente risolve a.txt con
    // un Edit e l'hook riparte: `git add -A` mette in scena anche b.txt coi
    // segni di conflitto, il commit nasce su una HEAD staccata (senza dirlo a
    // nessuno, e senza spedire niente) e il commit che il rebase stava
    // riportando — «mio» — sparisce: al suo posto «auto: a.txt, b.txt», con
    // dentro <<<<<<< e >>>>>>>. `git rebase --continue` poi dice
    // «Successfully rebased». Rilievo del giro 3, livello 1.
    test.fail(true, 'rilievo del giro 3: l\'hook committa i file ancora in conflitto e inghiotte il commit che il rebase stava riportando');
    const s = scenario('rebase');
    mainDiverge(s);
    const reb = gitTenta(s.lavoro, 'rebase', 'main');
    expect(reb.status, 'il rebase deve fermarsi sul conflitto').not.toBe(0);
    expect(existsSync(join(s.lavoro, '.git', 'rebase-merge'))).toBe(true);
    writeFileSync(join(s.lavoro, 'a.txt'), 'risolto\n');
    const r = hook(s.lavoro);
    expect(r.status).toBe(0);
    // b.txt è ancora in conflitto: non deve stare in nessun commit coi segni.
    const inHead = spawnSync('git', ['show', 'HEAD:b.txt'], { cwd: s.lavoro, encoding: 'utf8' }).stdout || '';
    expect(inHead, `b.txt committato coi segni di conflitto:\n${inHead}`).not.toMatch(SEGNI);
    // Il commit che il rebase stava riportando deve poter arrivare col suo nome.
    writeFileSync(join(s.lavoro, 'b.txt'), 'risolto\n');
    git(s.lavoro, 'add', '-A');
    const cont = spawnSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', 'rebase', '--continue'], { cwd: s.lavoro, encoding: 'utf8', env: { ...process.env, GIT_EDITOR: 'true' } });
    expect(cont.status).toBe(0);
    expect(git(s.lavoro, 'log', '--format=%s', '-3')).toContain('mio');
  });

  test('durante una fusione ferma su due conflitti, un Edit su un file non chiude la fusione con l\'altro file pieno di segni, e su origin', () => {
    // Stessa scena con `git merge` (il ramo resta un ramo, non una HEAD
    // staccata): l'hook chiude la fusione con b.txt ancora pieno di segni e
    // la spedisce su origin. Rilievo del giro 3, livello 1: è la strada su cui
    // i segni di conflitto arrivano al server e a chi verifica.
    test.fail(true, 'rilievo del giro 3: la fusione viene chiusa e spedita con un file ancora in conflitto');
    const s = scenario('merge');
    mainDiverge(s);
    const m = gitTenta(s.lavoro, 'merge', 'main');
    expect(m.status, 'la fusione deve fermarsi sul conflitto').not.toBe(0);
    writeFileSync(join(s.lavoro, 'a.txt'), 'risolto\n');
    const r = hook(s.lavoro);
    expect(r.status).toBe(0);
    const suOrigin = spawnSync('git', ['show', 'claude/prova:b.txt'], { cwd: s.origin, encoding: 'utf8' }).stdout || '';
    expect(suOrigin, `su origin b.txt porta i segni di conflitto:\n${suOrigin}`).not.toMatch(SEGNI);
    expect(readFileSync(join(s.lavoro, 'b.txt'), 'utf8')).toMatch(SEGNI); // il file a terra è ancora da risolvere, e va bene
  });
});
