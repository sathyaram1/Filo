// Verifica #1737 giro 4, rilievo 1: la prova degli unit sulla fusione (quella di GitHub e del cancello) lancia gli unit
// con FILO_UNIT_LONTANE=0; lì le sentinelle del ramo devono restare verdi, o la fusione si ferma su un rosso nuovo.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 le sentinelle del PC dell\'owner sono verdi anche nella prova sulla fusione', () => {
  test.setTimeout(240_000);
  const { NODE_TEST_CONTEXT: _c, FILO_UNIT_DIR: _d, ...env } = process.env;
  // Come lanciaUnit della prova sulla fusione: i file li sceglie lei, la regola del PC è spenta.
  env.FILO_UNIT_LONTANE = '0';
  const p = spawnSync(process.execPath, [join(ROOT, 'scripts', 'run-unit-tests.mjs'), '--solo', 'tests/unit/unitSulPc.test.mjs'],
    { cwd: ROOT, env, encoding: 'utf8', timeout: 220_000 });
  const rossi = `${p.stdout}\n${p.stderr}`.split(/\r?\n/).filter((r) => /^not ok /.test(r));
  expect(rossi, 'unit rossi nella prova sulla fusione').toEqual([]);
  expect(p.status).toBe(0);
});
