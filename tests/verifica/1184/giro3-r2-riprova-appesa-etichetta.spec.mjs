// #1184 giro 3 — un file appeso durante la riprova non è «verde alla riprova»: l'avviso dei flaky lo dava per ripassato
// perché un altro file, rosso vero, aveva riportato il suo rosso prima della chiusura.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const RADICE = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const RIPROVA = join(RADICE, 'scripts', 'unit-con-riprova.mjs');

test('r2 un file appeso alla riprova non viene detto flaky ripassato', async () => {
  test.setTimeout(120_000);
  const rel = join('tests', '.smoke', `verifica1184g3-${process.pid}-${Date.now()}`);
  const dir = join(RADICE, rel);
  const tmp = cartellaTemporanea('v1184g3-');
  const segno = join(tmp, 'appeso.segno').replace(/\\/g, '/');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, 'a.test.mjs'), `import test from 'node:test'; import assert from 'node:assert';
test('rosso vero', () => { assert.equal(1, 2); });
`);
    writeFileSync(join(dir, 'b.test.mjs'), `import test from 'node:test'; import assert from 'node:assert';
import { existsSync, writeFileSync } from 'node:fs';
test('rosso, poi appeso', async () => {
  const c = existsSync(${JSON.stringify(segno)}); writeFileSync(${JSON.stringify(segno)}, '1');
  if (!c) assert.fail('rosso alla prima corsa');
  await new Promise(() => { setInterval(() => {}, 1000); });
});
`);
    const r = spawnSync(process.execPath, [RIPROVA, '--registro', join(tmp, 'unit.log')], {
      cwd: RADICE,
      env: { ...process.env, FILO_UNIT_DIR: rel, FILO_UNIT_TETTO_FERMO_MS: '4000' },
      encoding: 'utf8',
      timeout: 100_000,
    });
    const uscita = `${r.stdout}\n${r.stderr}`;
    expect(uscita, 'la riprova deve essersi fermata sul file appeso').toMatch(/b\.test\.mjs non è andato avanti/);
    expect(r.status).not.toBe(0);
    const flaky = uscita.match(/verdi alla riprova[^\n]*/)?.[0] || '';
    expect(flaky, `il file appeso alla riprova non è ripassato:\n${uscita.slice(-1500)}`).not.toMatch(/b\.test\.mjs/);
  } finally {
    togliCartella(dir);
    togliCartella(tmp);
  }
});
