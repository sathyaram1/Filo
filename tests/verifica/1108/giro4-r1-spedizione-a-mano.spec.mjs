// #1108 giro 4 — il salvataggio automatico, l'unico automatismo che gira in ogni sessione, non mette il controllo prima
// del push: un push a mano (quello che il suo stesso messaggio suggerisce) spedisce la copia finché finish, verifica o dispatch non l'hanno messo.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const RAMO = 'worker/prova-1108';
const COPIA = JSON.stringify({ documents: [{
  name: 'projects/p/databases/(default)/documents/feedback/abc',
  fields: { text: { stringValue: 'testo finto' }, clientId: { stringValue: 'cid-finto' }, userAgent: { stringValue: 'Mozilla/5.0 finto' } },
}] }, null, 2);

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const gitProva = (cwd, ...args) => {
  try { git(cwd, ...args); return true; } catch (_) { return false; }
};

function scena() {
  const dir = cartellaTemporanea('filo-1108-');
  const origin = join(dir, 'origin.git');
  const wt = join(dir, 'wt');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', wt]);
  writeFileSync(join(wt, 'a.txt'), 'a\n');
  git(wt, 'add', '-A'); git(wt, 'commit', '-qm', 'base');
  git(wt, 'remote', 'add', 'origin', origin);
  git(wt, 'push', '-q', 'origin', 'main:refs/heads/main');
  git(wt, 'checkout', '-qb', RAMO);
  writeFileSync(join(wt, 'b.txt'), 'b\n');
  git(wt, 'add', '-A'); git(wt, 'commit', '-qm', 'lavoro');
  git(wt, 'push', '-q', 'origin', `refs/heads/${RAMO}:refs/heads/${RAMO}`);
  git(wt, 'fetch', '-q', 'origin');
  return { dir, origin, wt };
}

function salvataggio(wt, file) {
  const ingresso = JSON.stringify({ hook_event_name: 'PostToolUse', tool_input: { file_path: join(wt, file) }, cwd: wt });
  return execFileSync('bash', [join(REPO, '.claude/hooks/auto-commit-merge.sh')], {
    cwd: wt, input: ingresso, encoding: 'utf8', env: { ...process.env, FILO_ROUTINE: '1', CLAUDE_PROJECT_DIR: wt },
  });
}

const suOrigin = (origin) => git(origin, 'log', '--all', '--format=', '--name-only');

test('r1 dopo un salvataggio automatico, una copia committata a mano non parte con un git push a mano', () => {
  const { dir, origin, wt } = scena();
  try {
    writeFileSync(join(wt, 'b.txt'), 'b2\n');
    salvataggio(wt, 'b.txt');
    writeFileSync(join(wt, 'feedback.json'), COPIA);
    git(wt, 'add', '-A'); git(wt, 'commit', '-qm', 'copia a mano');
    gitProva(wt, 'push', '-q', 'origin', `refs/heads/${RAMO}:refs/heads/${RAMO}`);
    expect(suOrigin(origin)).not.toContain('feedback.json');
  } finally { togliCartella(dir); }
});

test('r1 quando il salvataggio non spedisce per una copia, non suggerisce di spedire il ramo a mano', () => {
  const { dir, wt } = scena();
  try {
    writeFileSync(join(wt, 'feedback.json'), COPIA);
    git(wt, 'add', '-A'); git(wt, 'commit', '-qm', 'copia a mano');
    // Una fusione dopo la copia: il salvataggio non può togliere la copia da solo e si ferma.
    git(wt, 'checkout', '-q', 'main');
    writeFileSync(join(wt, 'c.txt'), 'c\n');
    git(wt, 'add', '-A'); git(wt, 'commit', '-qm', 'main avanti');
    git(wt, 'checkout', '-q', RAMO);
    git(wt, 'merge', '-q', '--no-edit', 'main');
    writeFileSync(join(wt, 'b.txt'), 'b2\n');
    const contesto = JSON.parse(salvataggio(wt, 'b.txt')).hookSpecificOutput.additionalContext;
    expect(contesto).toContain('NON spedisco il ramo');
    expect(contesto).not.toMatch(/git push del ramo/);
  } finally { togliCartella(dir); }
});
