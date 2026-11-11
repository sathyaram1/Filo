// #2237 giro 1: il confronto ramo/main su uno spec che Playwright non trova (nome sbagliato, o spec nuovo del ramo che
// su main non c'è) non deve dire «c'era già su main, non è del ramo»: lo spec lì non è girato, non è rosso.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 uno spec che non esiste non diventa un rosso già presente su main', () => {
  test.setTimeout(300_000);
  const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'spec-su-main.mjs'), 'tests/questo-spec-non-esiste-2237.spec.mjs'], {
    cwd: ROOT, encoding: 'utf8', timeout: 280_000, env: { ...process.env, FILO_REPO_ROOT: ROOT },
  });
  const uscita = `${r.stdout}\n${r.stderr}`;
  expect(r.status, uscita).not.toBe(0);
  expect(uscita, 'il verdetto attribuisce a main uno spec mai girato').not.toMatch(/c'era già su main/);
  expect(uscita).toMatch(/non (esiste|c'è|trovato)|nessuno spec|No tests found/i);
});
