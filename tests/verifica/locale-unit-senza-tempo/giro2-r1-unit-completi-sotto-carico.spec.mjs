// Verifica locale «unit-senza-tempo», giro 2, rilievo 1: con la macchina al triplo del carico la corsa intera degli
// unit non deve tagliare nessun file al tetto di tempo del lanciatore. Carico finto (thread a vuoto), lanciatore vero.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());

test.setTimeout(120 * 60_000);

test('r1 sotto carico triplo la corsa intera degli unit non taglia nessun file al tetto', async () => {
  const carico = Array.from({ length: availableParallelism() * 3 }, () => new Worker(
    'let x = 0; for (;;) { for (let i = 0; i < 1e7; i++) x += Math.sqrt(i); }', { eval: true }));
  let esito;
  try {
    esito = await new Promise((ok) => {
      const p = spawn(process.execPath, ['scripts/run-unit-tests.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.stderr.on('data', (c) => { out += c; });
      p.on('close', (code) => ok({ code, out }));
    });
  } finally {
    await Promise.all(carico.map((w) => w.terminate()));
  }
  const righe = esito.out.split('\n');
  const tagliati = righe.flatMap((l, i) => (/^not ok/.test(l) && righe.slice(i, i + 8).some((r) => /timed out/.test(r)) ? [l] : []));
  expect(tagliati, 'file tagliati al tetto di tempo').toEqual([]);
  expect(esito.code).toBe(0);
});
