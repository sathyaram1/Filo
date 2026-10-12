// #1108 giro 3, porta chiusa — un commit locale con una copia dei dati, lasciato da una sessione morta, non arriva su
// origin quando il lavoro riparte sullo stesso ramo (il ramo di scarto parte senza la copia).
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { prepareBranch } from '../../../scripts/lib/branch-integrity.mjs';

const RAMO = 'worker/prova-1108';
const COPIA = JSON.stringify({ documents: [{
  name: 'projects/p/databases/(default)/documents/feedback/abc',
  fields: { text: { stringValue: 'testo finto' }, clientId: { stringValue: 'cid-finto' }, userAgent: { stringValue: 'Mozilla/5.0 finto' } },
}] }, null, 2);

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('un commit locale con la copia, lasciato da una sessione morta, non arriva su origin quando il lavoro riparte sul ramo', () => {
  const dir = cartellaTemporanea('filo-1108-');
  const origin = join(dir, 'origin.git');
  const wt = join(dir, 'wt');
  try {
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
    writeFileSync(join(wt, 'feedback.json'), COPIA);
    git(wt, 'add', '-A'); git(wt, 'commit', '-qm', 'copia a mano');
    const esito = prepareBranch({ root: wt, branch: RAMO, checkpoint: null });
    expect(esito.ok).toBe(true);
    expect(git(origin, 'log', '--all', '--format=', '--name-only')).not.toContain('feedback.json');
  } finally { togliCartella(dir); }
});
