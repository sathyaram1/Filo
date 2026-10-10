// Verifica locale «unit-senza-tempo», giro 3, rilievo 3: con la macchina molto carica i file con prove lunghe e sincrone
// (la prova sulla fusione, il resto della riga di PowerShell) devono finire verdi dal lanciatore vero. Carico finto doppio
// e per mezz'ora al massimo: il PC è condiviso con altri lavori, e al quadruplo per due ore li faceva cadere (giro 4).
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
const FILE = ['tests/unit/unitSullaFusione.test.mjs', 'tests/unit/powershellRestoDellaRiga.test.mjs'];
const CARICO_PER_MS = 30 * 60_000;

test.setTimeout(60 * 60_000);

test('r3 sotto carico doppio le prove lunghe finiscono verdi senza essere chiuse dal tetto', async () => {
  const vuota = join(cartellaTemporanea('unit-prove-lunghe-'), 'unit');
  mkdirSync(vuota);
  writeFileSync(join(vuota, 'base.test.mjs'), "import test from 'node:test';\ntest('base', () => {});\n");
  const carico = Array.from({ length: availableParallelism() * 2 }, () => new Worker(
    'let x = 0; for (;;) { for (let i = 0; i < 1e7; i++) x += Math.sqrt(i); }', { eval: true }));
  const basta = setTimeout(() => carico.forEach((w) => w.terminate()), CARICO_PER_MS);
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
    clearTimeout(basta);
    await Promise.all(carico.map((w) => w.terminate()));
  }
  const rossi = esito.out.split('\n').filter((l) => /^not ok|non è andato avanti/.test(l));
  expect(rossi, esito.out.slice(-1500)).toEqual([]);
  expect(esito.code).toBe(0);
});
