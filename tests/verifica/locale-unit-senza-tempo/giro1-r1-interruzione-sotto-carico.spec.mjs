// Verifica locale «unit-senza-tempo», giro 1, rilievo 1: la prova dell'interruzione di npm run test:unit deve
// passare anche con la macchina carica. Il carico qui è finto (thread che girano a vuoto), le ripetute sono dieci.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const GIRI = 10;

test.setTimeout(20 * 60_000);

test('r1 la prova dell’interruzione resta verde con la macchina carica', async () => {
  const carico = Array.from({ length: availableParallelism() * 2 }, () => new Worker(
    'let x = 0; for (;;) { for (let i = 0; i < 1e7; i++) x += Math.sqrt(i); }', { eval: true }));
  const rossi = [];
  try {
    for (let i = 0; i < GIRI; i++) {
      const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=interrotto lascia solo',
        'tests/unit/cartelleTemporaneeSiTolgono.test.mjs'], { cwd: ROOT, encoding: 'utf8' });
      if (r.status !== 0 || !/# pass 1/.test(r.stdout)) rossi.push(`giro ${i + 1}: ${(r.stdout.match(/error: .*/) || [r.stdout.slice(-300)])[0]}`);
    }
  } finally {
    await Promise.all(carico.map((w) => w.terminate()));
  }
  expect(rossi, `rossa ${rossi.length} volte su ${GIRI}`).toEqual([]);
});
