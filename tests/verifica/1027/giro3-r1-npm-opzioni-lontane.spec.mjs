// #1027 giro 3, rilievo 1: le opzioni che npm si tiene senza il «--» vanno fermate anche quando non somigliano
// a una nostra (--budget=5, --parallelismo=3) o sono un'impostazione di npm scritta sulla riga (--cpu 50).

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

for (const extra of [['--budget=5'], ['--parallelismo=3'], ['--cpu', '50']]) {
  test(`npm run orchestra stato ${extra.join(' ')} senza «--» si ferma`, () => {
    const dir = cartellaTemporanea('orch-1027-g3-');
    const r = spawnSync('npm', ['run', '-s', 'orchestra', 'stato', ...extra], {
      cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', timeout: 60_000,
      env: { ...process.env, FILO_ORCH_DIR: join(dir, 'orch') },
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).not.toBe(0);
    expect(r.stdout).not.toMatch(/Orchestratore fermo|Coda vuota/);
  });
}
