// #2505 giro 3: col riallineamento la suite raccoglie 727 spec contro i ~690 dichiarati, oltre il 5%: la sentinella
// del numero della suite, verde su main da solo (726), diventa rossa sul ramo.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('r1 la sentinella del numero di spec dichiarato nei documenti è verde sul ramo riallineato', () => {
  const r = spawnSync(process.execPath, ['--test', 'tests/unit/proveDeiGiri.test.mjs'], { cwd: ROOT, encoding: 'utf8' });
  expect(r.stdout, 'la sentinella dice di scrivere il numero vero in CLAUDE.md e README.md').not.toMatch(/^not ok/m);
  expect(r.status).toBe(0);
});
