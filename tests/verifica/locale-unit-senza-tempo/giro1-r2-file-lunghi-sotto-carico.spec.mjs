// Verifica locale «unit-senza-tempo», giro 1, rilievo 2: con la macchina carica i file di unit che da soli durano
// mezzo minuto non devono arrivare al tetto di tempo per file del lanciatore. Carico finto, lanciatore vero.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
const FILE = ['tests/unit/terminaleCodifica.test.mjs', 'tests/unit/pathsLettura.test.mjs'];

test.setTimeout(45 * 60_000);

test('r2 sotto carico i file lunghi finiscono entro il tetto del lanciatore', async () => {
  const dir = cartellaTemporanea('unit-file-lunghi-');
  const vuota = join(dir, 'unit');
  mkdirSync(vuota);
  writeFileSync(join(vuota, 'base.test.mjs'), "import test from 'node:test';\ntest('base', () => {});\n");
  const carico = Array.from({ length: availableParallelism() * 3 }, () => new Worker(
    'let x = 0; for (;;) { for (let i = 0; i < 1e7; i++) x += Math.sqrt(i); }', { eval: true }));
  let esito;
  try {
    esito = await new Promise((ok) => {
      const p = spawn(process.execPath, ['scripts/run-unit-tests.mjs', ...FILE],
        { cwd: ROOT, env: { ...process.env, FILO_UNIT_DIR: vuota }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.stderr.on('data', (c) => { out += c; });
      p.on('close', (code) => ok({ code, out }));
    });
  } finally {
    await Promise.all(carico.map((w) => w.terminate()));
  }
  const appesi = esito.out.split('\n').filter((l) => /timed out|not ok/.test(l));
  expect(appesi, esito.out.slice(-1500)).toEqual([]);
  expect(esito.code).toBe(0);
});
