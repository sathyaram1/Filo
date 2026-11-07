// #2263 giro 1: la critica registrata dopo la cancellazione a mano di una prova (git rm + commit, che il salvataggio
// non spinge) deve trovare la sua punta su origin quando il server la legge, o viene respinta come «stale».
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const git = (cwd, ...args) => String(execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();

function scenario() {
  const base = cartellaTemporanea('verifica-2263-');
  const remoto = join(base, 'remoto.git');
  const clone = join(base, 'clone');
  mkdirSync(remoto);
  git(remoto, 'init', '--bare', '-q', '-b', 'main');
  git(base, 'clone', '-q', remoto, clone);
  git(clone, 'config', 'user.email', 'v@x');
  git(clone, 'config', 'user.name', 'v');
  writeFileSync(join(clone, 'app.js'), 'x\n');
  git(clone, 'add', '-A'); git(clone, 'commit', '-q', '-m', 'base');
  git(clone, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(clone, 'checkout', '-q', '-b', 'worker/prova');
  // La prova di esplorazione scritta e salvata (spinta), come fa il salvataggio automatico.
  mkdirSync(join(clone, 'tests', 'verifica', '9'), { recursive: true });
  writeFileSync(join(clone, 'tests', 'verifica', '9', 'giro1-esplora.spec.mjs'), 'esplora\n');
  git(clone, 'add', '-A'); git(clone, 'commit', '-q', '-m', 'auto: prova');
  git(clone, 'push', '-q', 'origin', 'HEAD:refs/heads/worker/prova');
  // Poi tolta a mano, come chiede il ruolo: commit solo locale.
  git(clone, 'rm', '-q', 'tests/verifica/9/giro1-esplora.spec.mjs');
  git(clone, 'commit', '-q', '-m', 'verifica #9 giro 1: via la prova di sola esplorazione');
  return { remoto, clone, punta: git(clone, 'rev-parse', 'HEAD') };
}

const sulRemoto = (remoto) => git(remoto, 'rev-parse', 'refs/heads/worker/prova');

test('la critica arriva al server con la punta della pulizia già su origin', async () => {
  const { remoto, clone, punta } = scenario();
  expect(sulRemoto(remoto)).not.toBe(punta);
  const { deliver } = await import('../../../scripts/routine-channel.mjs');
  let remotoAllaConsegna = '';
  const fetchImpl = async (url) => {
    if (/routineDeliver$/.test(String(url))) remotoAllaConsegna = sulRemoto(remoto);
    return new Response(JSON.stringify({ ok: true, reply: {} }), { status: 200 });
  };
  const r = await deliver('biglietto-finto', 'verdict', { verdict: 'x', branch: 'worker/prova', sha: punta }, { root: clone, fetchImpl, attempts: 1 });
  expect(r.outcome).toBe('ok');
  expect(remotoAllaConsegna).toBe(punta);
});

test('una seconda consegna con la punta già spinta non cambia niente e arriva', async () => {
  const { remoto, clone, punta } = scenario();
  const { deliver } = await import('../../../scripts/routine-channel.mjs');
  const fetchImpl = async () => new Response(JSON.stringify({ ok: true, reply: {} }), { status: 200 });
  await deliver('t', 'verdict', { verdict: 'x', branch: 'worker/prova', sha: punta }, { root: clone, fetchImpl, attempts: 1 });
  const r = await deliver('t', 'verdict', { verdict: 'x', branch: 'worker/prova', sha: punta }, { root: clone, fetchImpl, attempts: 1 });
  expect(r.outcome).toBe('ok');
  expect(sulRemoto(remoto)).toBe(punta);
  expect(git(clone, 'rev-parse', 'HEAD')).toBe(punta);
});
