// #1108 giro 3 — una copia dei dati del server rimasta in un commit locale non deve arrivare su origin da nessuna strada
// che spedisce: il prossimo lavoro sullo stesso ramo la parcheggia e la spedisce; il salvataggio, quando non spedisce, dice di fare git push.
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
    const ingresso = JSON.stringify({ hook_event_name: 'PostToolUse', tool_input: { file_path: join(wt, 'b.txt') }, cwd: wt });
    const out = execFileSync('bash', [join(REPO, '.claude/hooks/auto-commit-merge.sh')], {
      cwd: wt, input: ingresso, encoding: 'utf8', env: { ...process.env, FILO_ROUTINE: '1', CLAUDE_PROJECT_DIR: wt },
    });
    const contesto = JSON.parse(out).hookSpecificOutput.additionalContext;
    expect(contesto).toContain('NON spedisco il ramo');
    expect(contesto).not.toMatch(/git push del ramo/);
  } finally { togliCartella(dir); }
});
