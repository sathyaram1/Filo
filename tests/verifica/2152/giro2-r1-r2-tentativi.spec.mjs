// Verifica #2152 giro 2: quale tentativo morto si riprende e quale si chiude. Logica pura su un origin nudo usa-e-getta,
// senza Electron. r1: un tentativo vuoto (nato da main, mai un commit) non è «arrivato su main». r2: un fuso potato.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { tentativiPrecedenti } from '../../../scripts/lib/branch-integrity.mjs';

const ID = 'fid2152v';
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ramo = (stampo) => `worker/${ID}-${stampo}`;

function scena() {
  const base = cartellaTemporanea('verifica-2152-');
  const origin = resolve(base, 'origin.git');
  const casa = resolve(base, 'casa');
  mkdirSync(casa, { recursive: true });
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(casa, 'init', '-q', '-b', 'main');
  writeFileSync(resolve(casa, 'a.txt'), '0\n');
  git(casa, 'add', '-A');
  git(casa, 'commit', '-qm', 'base');
  git(casa, 'remote', 'add', 'origin', origin);
  git(casa, 'push', '-q', '-u', 'origin', 'main');
  return { base, casa };
}
function tentativo(casa, nome, n) {
  git(casa, 'checkout', '-q', '-B', nome, 'main');
  for (let i = 0; i < n; i += 1) {
    writeFileSync(resolve(casa, `${nome.replace(/\W/g, '_')}-${i}.txt`), `${i}\n`);
    git(casa, 'add', '-A');
    git(casa, 'commit', '-qm', `${nome} ${i}`);
  }
  git(casa, 'push', '-q', 'origin', `${nome}:refs/heads/${nome}`);
  git(casa, 'checkout', '-q', 'main');
}
function avanzaMain(casa, cosa) {
  writeFileSync(resolve(casa, `${cosa}.txt`), `${cosa}\n`);
  git(casa, 'add', '-A');
  git(casa, 'commit', '-qm', cosa);
  git(casa, 'push', '-q', 'origin', 'main');
}

test('r1 un tentativo morto con commit propri si riprende anche se dopo ne è nato uno vuoto da main', () => {
  const { base, casa } = scena();
  try {
    // Come #1140: un tentativo lavora 15 commit e muore; il successivo nasce da main e muore prima del primo commit.
    tentativo(casa, ramo('20261014T123553Z'), 15);
    avanzaMain(casa, 'fusione-di-un-altro-feedback');
    tentativo(casa, ramo('20261018T131834Z'), 0);
    const r = tentativiPrecedenti({ root: casa, id: ID, mainBranch: 'main', escludi: '' });
    expect(r.ok).toBe(true);
    expect(r.superati, 'il lavoro non fuso non va tolto da origin').toEqual([]);
    expect(r.scelto && r.scelto.ramo, 'il lavoro nuovo riparte dai 15 commit').toBe(ramo('20261014T123553Z'));
  } finally { togliCartella(base); }
});

test('r2 feedback riaperto dopo la potatura del tentativo fuso: il tentativo morto prima della fusione non è la base', () => {
  const { base, casa } = scena();
  try {
    tentativo(casa, ramo('20261012T100000Z'), 3);
    tentativo(casa, ramo('20261014T100000Z'), 2);
    git(casa, 'merge', '-q', '--no-ff', '-m', 'merge-gate: #9 via server', ramo('20261014T100000Z'));
    git(casa, 'push', '-q', 'origin', 'main');
    // La potatura del lunedì toglie il ramo fuso, che nessun feedback aperto nomina.
    git(casa, 'push', '-q', 'origin', `:refs/heads/${ramo('20261014T100000Z')}`);
    // Come la chiama dispatch: col numero del feedback, che legge la fusione su main.
    const r = tentativiPrecedenti({ root: casa, id: ID, num: '#9', mainBranch: 'main', escludi: '' });
    expect(r.ok).toBe(true);
    expect(r.scelto && r.scelto.ramo, 'il lavoro superato dalla fusione non torna come base').not.toBe(ramo('20261012T100000Z'));
  } finally { togliCartella(base); }
});
