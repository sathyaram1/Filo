// #1027 giro 1, rilievo 1: lanciato con npm senza il «--», npm si mangia le opzioni prima del lettore;
// «avvia --dry-run» deve rifiutarsi, non partire per un giro vero con la coda che c'è.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function orchestra(args, dir) {
  return spawnSync('npm', ['run', 'orchestra', ...args], {
    cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', timeout: 60_000,
    env: { ...process.env, FILO_ORCH_DIR: dir },
  });
}

test('avvia --dry-run senza «--» non fa un giro vero', () => {
  const dir = cartellaTemporanea('orch-1027-');
  const r = orchestra(['avvia', '--dry-run'], dir);
  expect(r.status, `${r.stdout}\n${r.stderr}`).not.toBe(0);
  expect(existsSync(join(dir, 'orchestratore.log'))).toBe(false);
});

test('avvia --paralleli=3 senza «--» non parte coi due di base', () => {
  const dir = cartellaTemporanea('orch-1027-');
  const r = orchestra(['avvia', '--dry-run', '--paralleli=3', '41'], dir);
  // Con un giro a vuoto il lavoro 41 entrerebbe nella prova: deve fermarsi prima, dicendolo.
  expect(r.status, `${r.stdout}\n${r.stderr}`).not.toBe(0);
  expect(r.stdout).not.toMatch(/#41/);
});
