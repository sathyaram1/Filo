// Verifica #1141.1 giro 3: main ha già isolato i figli dalla sessione con un aiuto suo (#1172.1); il ramo deve
// fondersi senza conflitti e la regola del transcript assente vivere in un aiuto solo.
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AIUTI = join(REPO, 'tests', 'helpers');

test('r1 il ramo si fonde con main senza conflitti e la regola del transcript assente sta in un aiuto solo', () => {
  spawnSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: REPO });
  const fusione = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', 'origin/main', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
  expect(fusione.status, fusione.stdout).toBe(0);
  const conRegola = readdirSync(AIUTI).filter((f) => f.endsWith('.mjs') && /transcript-che-non-esiste/.test(readFileSync(join(AIUTI, f), 'utf8')));
  expect(conRegola.length, conRegola.join(', ')).toBe(1);
  expect(execFileSync('git', ['ls-tree', '--name-only', 'origin/main', 'tests/helpers/'], { cwd: REPO, encoding: 'utf8' }))
    .toContain(`tests/helpers/${conRegola[0]}`);
});
