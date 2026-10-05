// #1027 giro 2, rilievo 1: un'impostazione di npm stesso (cafile nel .npmrc) non è un'opzione dell'orchestratore
// tenuta da npm: con il «--» scritto giusto, «stato» deve rispondere.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('con cafile nel .npmrc, npm run orchestra -- stato risponde', () => {
  const dir = cartellaTemporanea('orch-1027-g2-');
  const npmrc = join(dir, 'npmrc');
  writeFileSync(npmrc, `cafile=${join(dir, 'ca.pem')}\n`);
  writeFileSync(join(dir, 'ca.pem'), '');
  const r = spawnSync('npm', ['run', '-s', 'orchestra', '--', 'stato'], {
    cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', timeout: 60_000,
    env: { ...process.env, FILO_ORCH_DIR: join(dir, 'orch'), NPM_CONFIG_USERCONFIG: npmrc },
  });
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  expect(r.stdout).toMatch(/Orchestratore fermo|Coda vuota/);
});
