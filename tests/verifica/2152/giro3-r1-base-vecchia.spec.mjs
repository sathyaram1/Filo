// Verifica #2152 giro 3: un lavoro ripartito dalla punta di un tentativo morto deve vedere anche il main di adesso.
// Logica pura su un origin nudo usa-e-getta, senza Electron: i passi di positionOnBranch per un lavoro nuovo.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { tentativiPrecedenti, prepareBranch } from '../../../scripts/lib/branch-integrity.mjs';

const ID = 'fid2152w';
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ramo = (stampo) => `worker/${ID}-${stampo}`;
function commit(cwd, file) {
  writeFileSync(resolve(cwd, file), `${file}\n`);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', file);
}

test('r1 il lavoro ripartito dal tentativo morto contiene le fusioni arrivate su main dopo di lui', () => {
  const base = cartellaTemporanea('verifica-2152-g3-');
  try {
    const origin = resolve(base, 'origin.git');
    const casa = resolve(base, 'casa');
    mkdirSync(casa, { recursive: true });
    git(base, 'init', '-q', '--bare', '-b', 'main', origin);
    git(casa, 'init', '-q', '-b', 'main');
    commit(casa, 'base.txt');
    git(casa, 'remote', 'add', 'origin', origin);
    git(casa, 'push', '-q', '-u', 'origin', 'main');
    // Come #1170: il tentativo del 12 lavora e muore; nei giorni dopo main riceve le fusioni di altri feedback.
    const morto = ramo('20261012T100000Z');
    git(casa, 'checkout', '-q', '-b', morto);
    commit(casa, 'lavoro-del-12.txt');
    git(casa, 'push', '-q', 'origin', `${morto}:refs/heads/${morto}`);
    git(casa, 'checkout', '-q', 'main');
    commit(casa, 'fusione-di-un-altro-feedback.txt');
    git(casa, 'push', '-q', 'origin', 'main');
    const mainAdesso = git(casa, 'rev-parse', 'HEAD');

    const nuovo = ramo('20261018T100000Z');
    const p = tentativiPrecedenti({ root: casa, id: ID, num: '#9', mainBranch: 'main', escludi: nuovo });
    expect(p.ok).toBe(true);
    expect(p.scelto && p.scelto.ramo).toBe(morto);
    const r = prepareBranch({ root: casa, branch: nuovo, create: true, base: p.scelto.ramo, mainBranch: 'main' });
    expect(r.ok, r.message).toBe(true);
    let contiene = true;
    try { git(casa, 'merge-base', '--is-ancestor', mainAdesso, 'HEAD'); } catch (_) { contiene = false; }
    expect(contiene, 'il ramo nuovo lavora sul codice di adesso, non su quello del 12').toBe(true);
  } finally { togliCartella(base); }
});
