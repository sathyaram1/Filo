// #1680 giro 4, rilievo 1: i rami in corso che il manutentore riceve non devono contenere un tentativo morto, cioè un
// ramo di un feedback il cui tentativo più recente è già arrivato su main.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { ramiInCorso } from '../../../scripts/lib/su-main.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('r1 un tentativo vecchio di un feedback già fuso non risulta in corso', () => {
  const base = cartellaTemporanea('filo-1680-g4r1-');
  const origine = join(base, 'origine.git');
  const lavoro = join(base, 'lavoro');
  git(base, 'init', '--bare', '-q', '-b', 'main', origine);
  git(base, 'clone', '-q', origine, lavoro);
  git(lavoro, 'config', 'user.email', 'prova@filo.invalid');
  git(lavoro, 'config', 'user.name', 'prova');
  writeFileSync(join(lavoro, 'a.js'), 'uno\n');
  git(lavoro, 'add', '-A'); git(lavoro, 'commit', '-q', '-m', 'inizio');
  git(lavoro, 'push', '-q', 'origin', 'main');

  const vecchio = 'worker/abcDEF123456-20261020T100000Z';
  const nuovo = 'worker/abcDEF123456-20261022T100000Z';
  git(lavoro, 'checkout', '-q', '-b', vecchio, 'main');
  writeFileSync(join(lavoro, 'a.js'), 'tentativo morto\n');
  git(lavoro, 'commit', '-q', '-am', '#812 primo tentativo');
  git(lavoro, 'push', '-q', 'origin', vecchio);
  git(lavoro, 'checkout', '-q', '-b', nuovo, 'main');
  writeFileSync(join(lavoro, 'b.js'), 'tentativo buono\n');
  git(lavoro, 'add', '-A'); git(lavoro, 'commit', '-q', '-m', '#812 secondo tentativo');
  git(lavoro, 'push', '-q', 'origin', nuovo);
  git(lavoro, 'checkout', '-q', 'main');
  git(lavoro, 'merge', '-q', '--no-ff', '-m', 'merge-gate: #812', nuovo);
  git(lavoro, 'push', '-q', 'origin', 'main');
  git(lavoro, 'fetch', '-q', 'origin');

  const rami = ramiInCorso(lavoro).map((r) => r.ramo);
  expect(rami).not.toContain(vecchio);
});
