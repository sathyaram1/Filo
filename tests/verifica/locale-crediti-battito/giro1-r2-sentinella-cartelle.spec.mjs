// Giro 1, rilievo 2: i controlli di logica devono essere verdi. La sentinella delle cartelle temporanee
// era rossa sul ramo (due unit test nuovi tolgono la cartella con rmSync nudo invece di togliCartella).

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r2 la sentinella delle cartelle temporanee è verde', () => {
  const r = spawnSync(process.execPath, ['--test', resolve(ROOT, 'tests', 'unit', 'cartelleTemporanee.test.mjs')], { encoding: 'utf8', timeout: 120000 });
  const rossi = (r.stdout || '').split('\n').filter((l) => /^not ok/.test(l));
  expect(rossi, r.stdout.slice(-3000)).toEqual([]);
  expect(r.status).toBe(0);
});
