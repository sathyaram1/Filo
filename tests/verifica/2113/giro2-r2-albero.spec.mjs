// Verifica #2113 giro 2: le prove della ripresa sono verdi anche dove le lancia il controllo di fine lavoro, cioè
// nella cartella staccata sul commit, che ha node_modules un livello sopra e non dentro.
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apriProvaSulCommit } from '../../../scripts/lib/unit-sulla-fusione.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r2 le prove della ripresa passano nella cartella staccata del controllo di fine lavoro', async () => {
  test.setTimeout(600_000);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  const albero = apriProvaSulCommit({ root: REPO, sha });
  expect(albero.errore, 'cartella staccata aperta').toBeFalsy();
  try {
    const r = spawnSync(process.execPath, [join(albero.moduli, '@playwright', 'test', 'cli.js'), 'test', '--retries=0', '--reporter=line', 'tests/finish-ripresa.spec.mjs'],
      { cwd: albero.dir, encoding: 'utf8', timeout: 540_000, env: process.env });
    expect(r.status, `${r.stdout}\n${r.stderr}`.slice(-3000)).toBe(0);
  } finally { albero.chiudi(); }
});
