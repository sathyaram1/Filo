// Verifica locale «unit-a-gruppi», giro 1, rilievo 2: un file di prova con le quadre nel nome deve girare, e se è
// rosso l'esito degli unit deve essere rosso.
import { test, expect } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());


test('un test rosso in un file con le quadre nel nome rende rosso l’esito', () => {
  const dir = cartellaTemporanea('unit-quadre-');
  try {
    writeFileSync(join(dir, 'verde.test.mjs'), `import test from 'node:test';\ntest('verde', () => {});\n`);
    writeFileSync(join(dir, 'caso [1].test.mjs'), `import test from 'node:test'; import assert from 'node:assert';\ntest('rosso', () => assert.equal(1, 2));\n`);
    const { FILO_UNIT_TETTO_RIGA: _t, ...env } = process.env;
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs'], {
      cwd: ROOT, env: { ...env, FILO_UNIT_DIR: dir }, encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
