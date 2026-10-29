// #1779 giro 1 — se il server del codice non risponde al momento di preparare la cartella, la punta che la cartella
// ricorda è di un giro passato: chi verifica non deve ricevere quel codice come se fosse l'ultima consegna.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { prepareBranch } from '../../../scripts/lib/branch-integrity.mjs';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (cwd, testo) => {
  writeFileSync(resolve(cwd, 'lavoro.js'), testo, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', testo);
  return git(cwd, 'rev-parse', 'HEAD');
};

test('r1 con origin irraggiungibile la cartella riusata non consegna il giro passato come ultima consegna', () => {
  const base = cartellaTemporanea('filo-1779-');
  try {
    const origin = resolve(base, 'origin.git');
    const casa = resolve(base, 'casa');
    const altrove = resolve(base, 'altrove');
    mkdirSync(casa);
    mkdirSync(altrove);
    git(base, 'init', '-q', '--bare', '-b', 'main', origin);
    git(casa, 'init', '-q', '-b', 'main');
    commit(casa, 'base\n');
    git(casa, 'remote', 'add', 'origin', origin);
    git(casa, 'push', '-q', '-u', 'origin', 'main');
    git(casa, 'checkout', '-q', '-b', 'worker/r');
    const B = commit(casa, 'giro 2\n');
    git(casa, 'push', '-q', 'origin', 'worker/r');
    git(casa, 'checkout', '-q', 'main');
    git(altrove, 'clone', '-q', origin, '.');
    git(altrove, 'checkout', '-q', '-b', 'worker/r', 'origin/worker/r');
    const C = commit(altrove, 'giro 3: le correzioni\n');
    git(altrove, 'push', '-q', 'origin', 'worker/r');
    renameSync(origin, `${origin}.spento`);

    const r = prepareBranch({ root: casa, branch: 'worker/r', checkpoint: B });
    // O la cartella ha l'ultima consegna, o la preparazione si ferma e lo dice: mai il giro 2 dato per buono in silenzio.
    if (r.ok) expect(r.head, 'la cartella è sul codice del giro 2, prima delle correzioni del giro 3').toBe(C);
    else expect(r.kind).toBe('transient');
  } finally {
    togliCartella(base);
  }
});
