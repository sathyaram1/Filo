// Verifica #2152 giro 1: un feedback riaperto dopo la fusione non deve ripartire da un tentativo morto PRIMA di quello
// fuso: quel lavoro è stato superato da ciò che è già su main.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ID = 'R3abv7PYverifica2152';

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=v', '-c', 'user.email=v@v', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function commit(cwd, file, testo) {
  writeFileSync(join(cwd, file), testo);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', testo);
}

test('r1 un tentativo morto più vecchio di quello già fuso non diventa la base del lavoro sul feedback riaperto', async () => {
  const { tentativiPrecedenti } = await import(pathToFileURL(join(REPO, 'scripts', 'lib', 'branch-integrity.mjs')).href);
  const tmp = cartellaTemporanea('verifica-2152-');
  try {
    const origin = join(tmp, 'origin.git');
    const lavoro = join(tmp, 'lavoro');
    git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
    git(tmp, 'clone', '-q', origin, lavoro);
    commit(lavoro, 'base.txt', 'base');
    git(lavoro, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
    // Primo tentativo: muore prima di consegnare.
    git(lavoro, 'checkout', '-q', '-b', `worker/${ID}-20261012T100000Z`, 'main');
    commit(lavoro, 'rapporto.txt', 'primo tentativo, morto');
    git(lavoro, 'push', '-q', 'origin', `HEAD:refs/heads/worker/${ID}-20261012T100000Z`);
    // Secondo tentativo: consegna ed è fuso su main.
    git(lavoro, 'checkout', '-q', '-b', `worker/${ID}-20261014T100000Z`, 'main');
    commit(lavoro, 'rapporto.txt', 'secondo tentativo, fuso');
    git(lavoro, 'push', '-q', 'origin', `HEAD:refs/heads/worker/${ID}-20261014T100000Z`);
    git(lavoro, 'checkout', '-q', 'main');
    git(lavoro, 'merge', '-q', '--no-ff', '-m', 'merge-gate', `worker/${ID}-20261014T100000Z`);
    git(lavoro, 'push', '-q', 'origin', 'main');

    // L'owner riapre il feedback («manca qualcosa»): parte un lavoro nuovo.
    const r = tentativiPrecedenti({ root: lavoro, id: ID, mainBranch: 'main', escludi: `worker/${ID}-20261105T100000Z` });
    expect(r.ok).toBe(true);
    expect(r.scelto?.ramo ?? null, 'la base sarebbe il tentativo morto superato dalla fusione').toBeNull();
  } finally {
    togliCartella(tmp);
  }
});

test('r1 un tentativo morto DOPO la fusione (sul feedback riaperto) resta la base del lavoro nuovo', async () => {
  const { tentativiPrecedenti } = await import(pathToFileURL(join(REPO, 'scripts', 'lib', 'branch-integrity.mjs')).href);
  const tmp = cartellaTemporanea('verifica-2152-');
  try {
    const origin = join(tmp, 'origin.git');
    const lavoro = join(tmp, 'lavoro');
    git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
    git(tmp, 'clone', '-q', origin, lavoro);
    commit(lavoro, 'base.txt', 'base');
    git(lavoro, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
    git(lavoro, 'checkout', '-q', '-b', `worker/${ID}-20261014T100000Z`, 'main');
    commit(lavoro, 'rapporto.txt', 'fuso');
    git(lavoro, 'push', '-q', 'origin', `HEAD:refs/heads/worker/${ID}-20261014T100000Z`);
    git(lavoro, 'checkout', '-q', 'main');
    git(lavoro, 'merge', '-q', '--no-ff', '-m', 'merge-gate', `worker/${ID}-20261014T100000Z`);
    git(lavoro, 'push', '-q', 'origin', 'main');
    git(lavoro, 'checkout', '-q', '-b', `worker/${ID}-20261020T100000Z`, 'main');
    commit(lavoro, 'rapporto.txt', 'dopo la riapertura, morto');
    git(lavoro, 'push', '-q', 'origin', `HEAD:refs/heads/worker/${ID}-20261020T100000Z`);

    const r = tentativiPrecedenti({ root: lavoro, id: ID, mainBranch: 'main', escludi: `worker/${ID}-20261105T100000Z` });
    expect(r.ok).toBe(true);
    expect(r.scelto?.ramo).toBe(`worker/${ID}-20261020T100000Z`);
  } finally {
    togliCartella(tmp);
  }
});
