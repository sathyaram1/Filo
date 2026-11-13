// #2152.1 giro 1: un feedback chiuso, fuso dal cancello («merge-gate: #N») col ramo fuso già potato, lascia su origin i
// suoi tentativi morti: la pulizia che parte a ogni lavoro nuovo (di un ALTRO feedback) deve chiuderli.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { chiudiSuperatiOvunque } from '../../../scripts/lib/branch-integrity.mjs';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(cwd, file, body, msg = `auto: ${file}`) {
  writeFileSync(resolve(cwd, file), body, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}
/** Un tentativo come quelli veri: un commit automatico e la prova di chi l'ha verificato, che cita il numero. */
function tentativo(casa, nome, da, num) {
  git(casa, 'checkout', '-q', '-B', nome, da);
  const f = nome.replace(/\W/g, '_');
  commit(casa, `${f}.js`, 'lavoro\n');
  const head = commit(casa, `${f}.spec.mjs`, 'prova\n', `verifica ${num} giro 1: prove`);
  git(casa, 'push', '-q', '-f', 'origin', `${nome}:refs/heads/${nome}`);
  git(casa, 'checkout', '-q', 'main');
  return head;
}

test('r1 a ogni lavoro nuovo se ne vanno i tentativi morti di un feedback chiuso dal cancello, col ramo fuso già potato', () => {
  const base = cartellaTemporanea('filo-verifica-2152-1-');
  try {
    const origin = resolve(base, 'origin.git');
    const casa = resolve(base, 'casa');
    mkdirSync(casa, { recursive: true });
    git(base, 'init', '-q', '--bare', '-b', 'main', origin);
    git(casa, 'init', '-q', '-b', 'main');
    const main = commit(casa, 'segnaposto.txt', 'x\n', 'inizio');
    git(casa, 'remote', 'add', 'origin', origin);
    git(casa, 'push', '-q', '-u', 'origin', 'main');

    const chiuso = 'fid-1140';
    const morti = [`worker/${chiuso}-20261012T000000Z`, `worker/${chiuso}-20261013T000000Z`];
    for (const m of morti) tentativo(casa, m, main, '#1140');
    const fusoNome = `worker/${chiuso}-20261014T000000Z`;
    const fuso = tentativo(casa, fusoNome, main, '#1140');
    git(casa, 'merge', '-q', '--no-ff', '-m', 'merge-gate: #1140 via server (unit sulla fusione provati da GitHub)', fuso);
    git(casa, 'push', '-q', 'origin', 'main', `:refs/heads/${fusoNome}`);
    const vivo = tentativo(casa, 'worker/fid-2152-20261101T000000Z', main, '#2152');

    // Come la chiama dispatch: col numero e l'id del feedback che parte adesso, non di quello chiuso.
    const c = chiudiSuperatiOvunque({ root: casa, num: '#2152', id: 'fid-2152' });
    expect(c.ok, c.errore).toBe(true);
    expect(c.chiusi.sort()).toEqual([...morti].sort());
    expect(git(casa, 'ls-remote', 'origin', 'refs/heads/worker/*')).toBe(`${vivo}\trefs/heads/worker/fid-2152-20261101T000000Z`);
  } finally { togliCartella(base); }
});
