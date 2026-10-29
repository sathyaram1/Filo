// #1680 giro 5, rilievo 1: un ramo di una sessione locale (`claude/…`) il cui feedback è già arrivato su main da un
// altro ramo non è lavoro in corso: `incroci` non deve dire al manutentore di aspettarlo.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { main } from '../../../scripts/manutentore.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('r1 un ramo claude/ del feedback già fuso da un altro ramo non risulta in corso', async () => {
  const base = cartellaTemporanea('filo-1680-g5r1-');
  const origine = join(base, 'origine.git');
  const lavoro = join(base, 'lavoro');
  git(base, 'init', '--bare', '-q', '-b', 'main', origine);
  git(base, 'clone', '-q', origine, lavoro);
  git(lavoro, 'config', 'user.email', 'prova@filo.invalid');
  git(lavoro, 'config', 'user.name', 'prova');
  writeFileSync(join(lavoro, 'a.js'), 'uno\n');
  git(lavoro, 'add', '-A'); git(lavoro, 'commit', '-q', '-m', 'inizio');
  git(lavoro, 'push', '-q', 'origin', 'main');

  // La sessione locale comincia #812 su un suo ramo; il lavoro arriva su main da un ramo di una routine.
  git(lavoro, 'checkout', '-q', '-b', 'claude/regole-locali', 'main');
  writeFileSync(join(lavoro, 'a.js'), 'prima versione\n');
  git(lavoro, 'commit', '-q', '-am', '#812 regole: prima versione');
  git(lavoro, 'push', '-q', 'origin', 'claude/regole-locali');
  git(lavoro, 'checkout', '-q', '-b', 'worker/abcDEF123456-20261022T100000Z', 'main');
  writeFileSync(join(lavoro, 'a.js'), 'versione fusa\n');
  git(lavoro, 'commit', '-q', '-am', '#812 regole');
  git(lavoro, 'checkout', '-q', 'main');
  git(lavoro, 'merge', '-q', '--no-ff', '-m', 'merge-gate: #812 via server (lavoro fidato, L5 registrato)', 'worker/abcDEF123456-20261022T100000Z');
  git(lavoro, 'push', '-q', 'origin', 'main');
  git(lavoro, 'fetch', '-q', 'origin');

  // L'indice delle schede: #812 non è più fra gli aperti, #900 sì e tocca lo stesso file.
  const schede = join(base, 'schede');
  mkdirSync(schede, { recursive: true });
  writeFileSync(join(schede, 'indice.json'), JSON.stringify([{ id: 'DDD', num: '900', stato: 'todo', priorita: 1, aggiornato: 'x' }]));
  writeFileSync(join(schede, '900.json'), JSON.stringify({
    numero: '900', titolo_breve: 'Regole', riassunto: 'r', valido: 'si', tipo: 'bug', area: 'altro', urgente: false, file_probabili: ['a.js'],
  }));

  const righe = [];
  const log = console.log;
  console.log = (...a) => righe.push(a.join(' '));
  try {
    expect(await main(['incroci', '900', '--cartella', schede, '--senza-fetch'], { root: lavoro })).toBe(0);
  } finally { console.log = log; }
  expect(righe.join('\n')).not.toContain('claude/regole-locali');
});
