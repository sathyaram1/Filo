// Verifica locale «unit-senza-tempo», giro 5, rilievo 1: con la macchina carica le prove che chiedono al sistema se un
// comando esiste devono restare verdi. Carico finto un thread per processore, per dieci minuti al massimo.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const COPIE = 3;
const CARICO_PER_MS = 10 * 60_000;

test.setTimeout(20 * 60_000);

test('r1 sotto carico le prove del comando che esiste restano verdi', async () => {
  const carico = Array.from({ length: availableParallelism() }, () => new Worker(
    'let x = 0; for (;;) { for (let i = 0; i < 1e7; i++) x += Math.sqrt(i); }', { eval: true }));
  const basta = setTimeout(() => carico.forEach((w) => w.terminate()), CARICO_PER_MS);
  let esiti;
  try {
    esiti = await Promise.all(Array.from({ length: COPIE }, () => new Promise((ok) => {
      const p = spawn(process.execPath, ['--test', 'tests/unit/commandExists.test.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.stderr.on('data', (c) => { out += c; });
      p.on('close', (code) => ok({ code, out }));
    })));
  } finally {
    clearTimeout(basta);
    await Promise.all(carico.map((w) => w.terminate()));
  }
  const rossi = esiti.flatMap((e) => [...e.out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1].trim()));
  expect(rossi, 'prove rosse con la macchina carica').toEqual([]);
  expect(esiti.map((e) => e.code)).toEqual(Array(COPIE).fill(0));
});
