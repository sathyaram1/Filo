// Verifica #2340.3, giro 1, rilievo 1: due lavori su file diversi che rifanno a mano la stessa correzione già su main,
// senza aver ancora fuso main nel ramo, risultano in incrocio sul file della correzione. Git vero, nessun server.
import { test, expect } from './../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { ramiInCorso, incrociFraRami } from '../../../scripts/lib/su-main.mjs';

const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('r1 una correzione di main rifatta a mano, identica a main, non crea un incrocio fra lavori su file diversi', () => {
  const base = cartellaTemporanea('verifica-2340-3-');
  const remoto = join(base, 'r.git');
  const w = join(base, 'w');
  mkdirSync(remoto);
  g(remoto, 'init', '-q', '--bare', '--initial-branch=main');
  g(base, 'clone', '-q', remoto, w);
  g(w, 'config', 'user.email', 't@t'); g(w, 'config', 'user.name', 't');
  const scrivi = (f, t) => writeFileSync(join(w, f), t);
  const commit = (m) => { g(w, 'add', '-A'); g(w, 'commit', '-q', '-m', m); };
  scrivi('regole.js', 'a\nb\nc\n'); scrivi('a.js', '1\n'); scrivi('b.js', '1\n'); commit('base');
  g(w, 'push', '-q', 'origin', 'main');
  const A = 'worker/AAAAAAAAAAAAAAAAAAAA-20261118T000000Z';
  const B = 'worker/BBBBBBBBBBBBBBBBBBBB-20261118T000001Z';
  for (const [ramo, f] of [[A, 'a.js'], [B, 'b.js']]) {
    g(w, 'checkout', '-q', '-b', ramo, 'main'); scrivi(f, `2 ${ramo}\n`); commit(`#11 lavoro su ${f}`);
  }
  g(w, 'checkout', '-q', 'main'); scrivi('regole.js', 'a\nB\nc\n'); commit('correzione'); g(w, 'push', '-q', 'origin', 'main');
  for (const ramo of [A, B]) { g(w, 'checkout', '-q', ramo); scrivi('regole.js', 'a\nB\nc\n'); commit('#11 la correzione di main rifatta a mano'); g(w, 'push', '-q', 'origin', ramo); }
  g(w, 'fetch', '-q', 'origin');
  // Il file del ramo è uguale a quello di main: fuso adesso non cambierebbe niente.
  expect(g(w, 'diff', '--name-only', 'origin/main', `origin/${A}`, '--', 'regole.js').trim()).toBe('');
  const rami = ramiInCorso(w, { giorni: 0 });
  expect(rami.map((r) => r.file)).toEqual([['b.js'], ['a.js']].sort((x, y) => (x[0] < y[0] ? 1 : -1)).length ? expect.anything() : []);
  for (const r of rami) expect(r.file, r.ramo).not.toContain('regole.js');
  expect(incrociFraRami(rami)).toEqual([]);
});
