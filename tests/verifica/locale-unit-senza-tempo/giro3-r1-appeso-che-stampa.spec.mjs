// Verifica locale «unit-senza-tempo», giro 3, rilievo 1: un file di unit appeso che continua a stampare deve essere
// chiuso dal tetto del lanciatore come uno muto, invece di tenere ferma la corsa per sempre. Tetto abbassato a 20 s.
import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
const TETTO_MS = 20_000;
const ATTESA_MS = 180_000;

test.setTimeout(ATTESA_MS + 120_000);

test('r1 un file appeso che stampa viene chiuso dal tetto e la corsa finisce rossa col suo nome', async () => {
  const dir = join(cartellaTemporanea('unit-appeso-stampa-'), 'unit');
  mkdirSync(dir);
  writeFileSync(join(dir, 'chiacchiera.test.mjs'), [
    "import test from 'node:test';",
    "test('appeso che stampa', async () => {",
    "  setInterval(() => console.log('aspetto ancora...'), 1000);",
    '  await new Promise(() => {});',
    '});',
    '',
  ].join('\n'));
  const c = spawn(process.execPath, ['scripts/run-unit-tests.mjs'], {
    cwd: ROOT, env: { ...process.env, FILO_UNIT_DIR: dir, FILO_UNIT_TETTO_FERMO_MS: String(TETTO_MS) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { out += d; });
  const esito = await new Promise((ok) => {
    const t = setTimeout(() => ok(null), ATTESA_MS);
    c.on('close', (code) => { clearTimeout(t); ok({ code }); });
  });
  if (!esito) {
    const kill = process.platform === 'win32'
      ? ['taskkill', ['/pid', String(c.pid), '/T', '/F']] : ['kill', ['-9', String(c.pid)]];
    spawnSync(kill[0], kill[1], { stdio: 'ignore' });
  }
  expect(esito, `dopo ${ATTESA_MS / 1000} s con un tetto di ${TETTO_MS / 1000} s la corsa era ancora aperta`).not.toBeNull();
  expect(esito.code).not.toBe(0);
  expect(out).toMatch(/ROSSO: .*chiacchiera\.test\.mjs/);
});
