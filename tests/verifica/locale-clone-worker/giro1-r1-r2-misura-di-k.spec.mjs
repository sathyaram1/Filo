// Verifica locale clone-worker, giro 1: la misura di K lanciata coi suoi valori predefiniti, su un principale canarino
// (node_modules finto, mai quello vero). npm e npx finti: finish:check vero, unit saltati, ogni lancio di Playwright annotato.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const leggi = (f) => { try { return readFileSync(f, 'utf8'); } catch (_) { return null; } };
// Dopo un caso rosso Playwright riparte con un worker nuovo e rifà beforeAll: la misura (minuti) si fa una volta per corsa.
const ESITO = join(tmpdir(), 'k-verifica-giro1.json');

let esito = null;

test.beforeAll(() => {
  test.setTimeout(60 * 60 * 1000);
  const giaFatto = leggi(ESITO);
  if (giaFatto) { esito = JSON.parse(giaFatto); return; }
  const base = cartellaTemporanea('k-verifica-');
  const canarino = join(base, 'principale');
  const sha = git(ROOT, 'rev-parse', 'origin/main').stdout.trim();
  const url = git(ROOT, 'remote', 'get-url', 'origin').stdout.trim();
  expect(git(base, 'clone', '-q', '--shared', '--no-checkout', ROOT, canarino).status).toBe(0);
  expect(git(canarino, 'checkout', '-q', sha).status).toBe(0);
  expect(git(canarino, 'remote', 'set-url', 'origin', url).status).toBe(0);
  mkdirSync(join(canarino, 'node_modules'), { recursive: true });
  writeFileSync(join(canarino, 'node_modules', 'CANARINO.txt'), 'canarino\n');

  // Un worker già al lavoro prima della misura, registrato come lo registra il comando dei clone.
  const comune = git(canarino, 'rev-parse', '--path-format=absolute', '--git-common-dir').stdout.trim();
  const registro = join(comune, 'filo-cloni');
  const cloneVero = join(base, 'clone-vero-1');
  mkdirSync(registro, { recursive: true });
  mkdirSync(cloneVero, { recursive: true });
  writeFileSync(join(registro, '1'), `${cloneVero}\n`);

  const finti = join(base, 'finti');
  mkdirSync(finti, { recursive: true });
  writeFileSync(join(finti, 'npm.cmd'), [
    '@echo off',
    'if "%1 %2"=="run finish:check" ( node scripts\\finish-local.mjs --check & exit /b %ERRORLEVEL% )',
    'if "%1 %2"=="run test:unit" ( echo FINTO-UNIT & exit /b 0 )',
    'echo FINTO-NPM %*',
    'exit /b 0',
    '',
  ].join('\r\n'));
  writeFileSync(join(finti, 'npx.cmd'), '@echo off\r\necho FINTO-NPX %*\r\nexit /b 0\r\n');
  writeFileSync(join(finti, 'npm'), [
    '#!/bin/sh',
    'if [ "$1 $2" = "run finish:check" ]; then exec node scripts/finish-local.mjs --check; fi',
    'if [ "$1 $2" = "run test:unit" ]; then echo FINTO-UNIT; exit 0; fi',
    'echo "FINTO-NPM $*"; exit 0',
    '',
  ].join('\n'));
  writeFileSync(join(finti, 'npx'), '#!/bin/sh\necho "FINTO-NPX $*"\nexit 0\n');
  chmodSync(join(finti, 'npm'), 0o755);
  chmodSync(join(finti, 'npx'), 0o755);

  const env = { ...process.env, FILO_REPO_ROOT: canarino, FILO_TOOLS_DIR: join(base, 'strumenti') };
  const chiave = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[chiave] = `${finti}${delimiter}${env[chiave] || ''}`;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'misura-k.mjs'), '--corse', '1', '--base', join(base, 'k')], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 55 * 60 * 1000,
  });
  esito = {
    uscita: `${r.stdout || ''}\n${r.stderr || ''}`.slice(-3000),
    log: leggi(join(base, 'k', 'corsa-1-n1', 'worker-1.log')) || '',
    voce: (leggi(join(registro, '1')) || '').trim() || null,
    cloneVero,
    canarino: existsSync(join(canarino, 'node_modules', 'CANARINO.txt')),
  };
});

test('r1 la misura di K coi valori predefiniti fa girare le prove Electron in ogni worker', () => {
  expect(esito.canarino, 'il node_modules del principale non deve sparire').toBe(true);
  expect(
    esito.log,
    `nel worker non è partito nessuno spec Playwright: la misura vede solo gli unit test.\n--- log del worker ---\n${esito.log}\n--- misura ---\n${esito.uscita}`,
  ).toMatch(/FINTO-NPX\s+playwright/);
});

test('r2 la misura non toglie dal registro i clone dei worker che c’erano già', () => {
  expect(esito.voce, `il registro del principale ha perso il clone del worker 1.\n--- misura ---\n${esito.uscita}`).toBe(esito.cloneVero);
});
