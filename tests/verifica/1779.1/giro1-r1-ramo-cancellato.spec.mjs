// Verifica #1779.1 giro 1, rilievo 1: origin risponde che il ramo non c'è più, ma la cartella riusata lo ricorda dal
// giro 2. Una cartella nuova si ferma («il ramo non esiste più»); quella riusata non deve consegnare il giro 2.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { prepareBranch } from '../../../scripts/lib/branch-integrity.mjs';

const RAMO = 'worker/v1779-cancellato';
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(cwd, file, body) {
  writeFileSync(resolve(cwd, file), body, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', file);
  return git(cwd, 'rev-parse', 'HEAD');
}
void dirname; void fileURLToPath;

test('r1 ramo cancellato su origin: la cartella che lo ricorda non consegna il giro 2', () => {
  const base = cartellaTemporanea('filo-v1779-');
  try {
    const origin = resolve(base, 'origin.git');
    const casa = resolve(base, 'casa');
    const altrove = resolve(base, 'altrove');
    git(base, 'init', '-q', '--bare', '-b', 'main', origin);
    mkdirSync(casa);
    git(casa, 'init', '-q', '-b', 'main');
    writeFileSync(resolve(casa, '.gitattributes'), '* text=auto eol=lf\n', 'utf8');
    commit(casa, 'segnaposto.txt', 'x\n');
    git(casa, 'remote', 'add', 'origin', origin);
    git(casa, 'push', '-q', '-u', 'origin', 'main');
    git(casa, 'checkout', '-q', '-b', RAMO);
    const giro2 = commit(casa, 'lavoro.js', 'giro 2\n');
    git(casa, 'push', '-q', 'origin', RAMO);
    git(casa, 'checkout', '-q', 'main');
    git(base, 'clone', '-q', origin, altrove);
    git(altrove, 'push', '-q', 'origin', '--delete', RAMO);

    const nuova = resolve(base, 'nuova');
    git(base, 'clone', '-q', origin, nuova);
    const daNuova = prepareBranch({ root: nuova, branch: RAMO, checkpoint: null });
    expect(daNuova.ok, 'una cartella nuova si ferma: il ramo non c\'è più').toBe(false);

    const r = prepareBranch({ root: casa, branch: RAMO, checkpoint: giro2 });
    expect(r.ok && r.head === giro2, `la cartella riusata ha consegnato il giro 2 (${r.head}) di un ramo che origin non ha più`).toBe(false);
  } finally {
    togliCartella(base);
  }
});
