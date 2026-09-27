// Verifica locale, giro 1 (ramo claude/prove-rosse-blocco): la sentinella di #742 riconosce anche il
// collegamento creato con la forma asincrona di node, che su Windows senza privilegi dà lo stesso EPERM.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const FINTO = join(REPO, 'tests', 'unit', `zzCollegamentoFinto${process.pid}.test.mjs`);

test('un test con symlink asincrono fa diventare rossa la sentinella', () => {
  writeFileSync(FINTO, [
    "import test from 'node:test';",
    "import { symlink } from 'node:fs/promises';",
    "test('collega', async () => { await symlink('a', 'b'); });",
    '',
  ].join('\n'));
  try {
    const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=collegamento che Windows',
      join(REPO, 'tests', 'unit', 'cartelleTemporanee.test.mjs')], { cwd: REPO, encoding: 'utf8' });
    expect(r.stdout).toMatch(/^# pass 0$/m);
    expect(r.stdout).toMatch(/^# fail 1$/m);
  } finally {
    rmSync(FINTO, { force: true });
  }
});
