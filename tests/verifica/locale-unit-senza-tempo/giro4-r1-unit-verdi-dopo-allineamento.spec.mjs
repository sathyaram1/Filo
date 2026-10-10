// Verifica locale «unit-senza-tempo», giro 4, rilievo 1: dopo l'allineamento con main gli unit del ramo devono restare
// verdi a macchina libera. La guardia contro i tempi scritti a mano non deve trovare file arrivati da main e restare rossa.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());

test.setTimeout(10 * 60_000);

test('r1 la guardia dei tempi scritti a mano è verde sul ramo allineato a main', () => {
  const r = spawnSync(process.execPath, ['--test', 'tests/unit/tempiSottoCarico.test.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const rossi = r.stdout.split('\n').filter((l) => /^not ok|^\s+'tests\/unit\//.test(l));
  expect(rossi, r.stdout.slice(-2000)).toEqual([]);
  expect(r.status).toBe(0);
});
