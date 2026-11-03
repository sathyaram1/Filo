// Verifica #1868, giro 1, rilievo 1: il caso dell'errore di rete dei contatori anonimi, lanciato da solo più volte di
// fila senza ritentativi e con la macchina carica (come nel controllo di fine lavoro), è verde ogni volta. Il carico
// qui è finto: thread che girano a vuoto.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { availableParallelism, tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const VOLTE = 6;

test.setTimeout(15 * 60_000);

test('r1 il caso dell’errore di rete è verde sei volte di fila con la macchina carica', async () => {
  const fuori = mkdtempSync(join(tmpdir(), 'filo-1868-r1-'));
  const carico = Array.from({ length: availableParallelism() * 2 }, () => new Worker(
    'let x = 0; for (;;) { for (let i = 0; i < 1e7; i++) x += Math.sqrt(i); }', { eval: true }));
  try {
    const r = spawnSync('npx', ['playwright', 'test', 'tests/contatori-anonimi.spec.mjs', '-g', 'pagina d’errore di rete',
      `--repeat-each=${VOLTE}`, '--retries=0', '--workers=1', '--reporter=line', `--output=${fuori}`],
    { cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 14 * 60_000 });
    const testo = `${r.stdout || ''}${r.stderr || ''}`.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const passate = Number((testo.match(/(\d+) passed/) || [])[1] || 0);
    expect(passate, testo.slice(-4000)).toBe(VOLTE);
  } finally {
    await Promise.all(carico.map((w) => w.terminate()));
    rmSync(fuori, { recursive: true, force: true });
  }
});
