// Verifica locale «unit-senza-tempo», giro 3, rilievo 2: dopo l'allineamento con main la corsa degli unit del ramo deve
// restare verde; la sentinella sulle cartelle tolte con rmSync nudo trova invece file arrivati da main.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());

test.setTimeout(15 * 60_000);

test('r2 la sentinella delle cartelle tolte con rmSync nudo è verde sul ramo', () => {
  const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=rmSync nudo', 'tests/unit/cartelleTemporanee.test.mjs'],
    { cwd: ROOT, encoding: 'utf8' });
  const colpevoli = [...new Set(r.stdout.match(/[\w\\/.-]+\.test\.mjs(?=')/g) || [])].join(', ');
  expect(r.status, `sentinella rossa: ${colpevoli || r.stdout.slice(-800)}`).toBe(0);
  expect(r.stdout).toMatch(/# pass 1/);
});

test('r2 la prova arrivata da main sulla nota che sparisce gira senza errori sul ramo', () => {
  const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=la nota sparisce da sola', 'tests/unit/transparency.test.mjs'],
    { cwd: ROOT, encoding: 'utf8' });
  expect(r.status, (r.stdout.match(/error: .*/) || [r.stdout.slice(-800)])[0]).toBe(0);
  expect(r.stdout).toMatch(/# pass 1/);
});
