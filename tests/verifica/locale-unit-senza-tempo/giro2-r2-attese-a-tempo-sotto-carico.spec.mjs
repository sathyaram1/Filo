// Verifica locale «unit-senza-tempo», giro 2, rilievo 2: le prove che aspettano un numero fisso di millisecondi invece
// dell'evento cadono con la macchina carica. Sessanta copie insieme del file, carico finto quadruplo: nessuna rossa.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const FILE = 'tests/unit/safebrowseFrenoPerDominio.test.mjs';
const COPIE = 60;

test.setTimeout(30 * 60_000);

test('r2 le attese a tempo fisso reggono la macchina carica', async () => {
  const carico = Array.from({ length: availableParallelism() * 4 }, () => new Worker(
    'let x = 0; for (;;) { for (let i = 0; i < 1e7; i++) x += Math.sqrt(i); }', { eval: true }));
  let esiti;
  try {
    esiti = await Promise.all(Array.from({ length: COPIE }, () => new Promise((ok) => {
      const p = spawn(process.execPath, ['--test', FILE], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.on('close', (code) => ok({ code, rossi: out.split('\n').filter((l) => /^not ok/.test(l)) }));
    })));
  } finally {
    await Promise.all(carico.map((w) => w.terminate()));
  }
  const rosse = esiti.filter((e) => e.code !== 0);
  expect(rosse.flatMap((e) => e.rossi), `rosse ${rosse.length} copie su ${COPIE}`).toEqual([]);
});
