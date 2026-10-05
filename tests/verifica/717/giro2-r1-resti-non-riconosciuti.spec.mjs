// #717 giro 2: quello che una corsa dei controlli di logica lascia nella temporanea deve essere riconosciuto dalla
// pulizia del giorno dopo; altrimenti resta per sempre. Due porte: un file di prova lanciato da solo, e la corsa interrotta.

import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, cartelleOrfane, ORFANA_DOPO_MS } from '../../helpers/percorsi.mjs';

const RADICE = process.cwd();
// Cache di Node e di Playwright: nome fisso, riusate a ogni corsa, non crescono.
const CACHE = new Set(['node-compile-cache', 'playwright-transform-cache-0']);

function banco() {
  const base = cartellaTemporanea('filo-v717-');
  const tmp = join(base, 'tmp');
  mkdirSync(tmp);
  const env = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, FILO_ROUTINE: '1' };
  delete env.NODE_TEST_CONTEXT;
  return { base, tmp, env };
}

function nonRiconosciuti(tmp) {
  const domani = Date.now() + ORFANA_DOPO_MS + 60_000;
  const tolte = new Set(cartelleOrfane({ dove: [tmp], oraMs: domani }).map((p) => p.split(/[\\/]/).pop()));
  return readdirSync(tmp).filter((n) => !CACHE.has(n) && !tolte.has(n));
}

test('un file di prova lanciato da solo non lascia resti che nessuno toglierà', () => {
  test.setTimeout(300_000);
  const b = banco();
  const r = spawnSync(process.execPath, ['--test', 'tests/unit/routineChain.test.mjs'], { cwd: RADICE, env: b.env, encoding: 'utf8' });
  expect(r.status, r.stdout.slice(-2000)).toBe(0);
  expect(nonRiconosciuti(b.tmp)).toEqual([]);
});

test('i controlli di logica interrotti non lasciano resti che nessuno toglierà', async () => {
  test.setTimeout(120_000);
  const b = banco();
  const unit = join(b.base, 'unit');
  mkdirSync(unit);
  writeFileSync(join(unit, 'appesa.test.mjs'), "import { test } from 'node:test';\ntest('appesa', () => new Promise(() => setInterval(() => {}, 1000)));\n");
  const figlio = spawn(process.execPath, [join(RADICE, 'scripts', 'run-unit-tests.mjs')],
    { cwd: RADICE, env: { ...b.env, FILO_UNIT_DIR: unit }, stdio: 'ignore' });
  const fine = Date.now() + 30_000;
  while (Date.now() < fine && !readdirSync(b.tmp).some((n) => n.startsWith('filo-unit-'))) await new Promise((ok) => setTimeout(ok, 100));
  await new Promise((ok) => setTimeout(ok, 1000));
  figlio.kill('SIGINT');
  await once(figlio, 'exit');
  expect(existsSync(b.tmp)).toBe(true);
  expect(nonRiconosciuti(b.tmp)).toEqual([]);
});
