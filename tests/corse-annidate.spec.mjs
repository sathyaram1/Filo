// Una prova che lancia un'altra corsa di Playwright (#2169): finita quella di dentro, quella di fuori trova ancora la sua
// temporanea e le prove che vengono dopo chiedono cartelle senza ENOENT. Nessun Electron. Regole: tests/helpers/percorsi.mjs.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';

const RADICE = join(import.meta.dirname, '..');
// Risolto come un import: nella cartella di prova di finish:check node_modules sta un livello sopra il repo.
const CLI_PW = createRequire(import.meta.url).resolve('@playwright/test/cli');
const DENTRO = 'FILO_CORSA_ANNIDATA';
// Le variabili del lavoratore di fuori farebbero credere alla corsa di dentro di essere un suo lavoratore.
const ambienteDiDentro = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PLAYWRIGHT_|PW_|TEST_WORKER_INDEX|TEST_PARALLEL_INDEX)/.test(k))),
  [DENTRO]: '1',
});

test('una corsa lanciata da una prova lascia la temporanea a quella che la lancia', () => {
  test.skip(process.env[DENTRO] === '1', 'è la corsa di dentro');
  test.setTimeout(180_000);
  const fuori = tmpdir();
  const r = spawnSync(process.execPath, [CLI_PW, 'test', 'tests/corse-annidate.spec.mjs', '--grep', 'di dentro', '--retries=0', '--reporter=line'],
    { cwd: RADICE, env: ambienteDiDentro(), encoding: 'utf8', timeout: 170_000 });
  expect(r.status, `${r.stdout || ''}${r.stderr || ''}`.slice(-2000)).toBe(0);
  expect(`${r.stdout}`).toMatch(/1 passed/);
  expect(existsSync(fuori), `la corsa di dentro ha tolto ${fuori}`).toBe(true);
  const dopo = cartellaTemporanea('filo-2169-dopo-');
  expect(existsSync(dopo)).toBe(true);
  togliCartella(dopo);
});

test('la prova di dentro scrive nella temporanea che ha ereditato', () => {
  test.skip(process.env[DENTRO] !== '1', 'gira solo dentro la corsa annidata');
  const d = cartellaTemporanea('filo-2169-di dentro-');
  expect(existsSync(d)).toBe(true);
});
