// #1184 giro 2 — il cancello unit con la riprova dei rossi non deve dire verde se la prima corsa si è fermata.
// Un file appeso chiude la corsa: i file dopo di lui non riportano niente, nemmeno i loro rossi veri. Se intanto un
// altro file è rosso di un flaky, la riprova rifà solo quello, lo trova verde, e il cancello esce 0.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const RADICE = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const RIPROVA = join(RADICE, 'scripts', 'unit-con-riprova.mjs');

test('r1 un file appeso più un flaky: il cancello resta rosso', async () => {
  test.setTimeout(120_000);
  // Dentro il repo (ignorata da git): le chiavi dei rossi sono relative alla radice, e la riprova le rilancia da lì.
  const rel = join('tests', '.smoke', `verifica1184-${process.pid}-${Date.now()}`);
  const dir = join(RADICE, rel);
  const tmp = cartellaTemporanea('v1184-');
  const segno = join(tmp, 'flaky.segno').replace(/\\/g, '/');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, 'a.test.mjs'), `import test from 'node:test'; import assert from 'node:assert';
import { existsSync, writeFileSync } from 'node:fs';
test('flaky', () => { const c = existsSync(${JSON.stringify(segno)}); writeFileSync(${JSON.stringify(segno)}, '1'); assert.ok(c); });
`);
    writeFileSync(join(dir, 'b.test.mjs'), `import test from 'node:test';
test('appeso', async () => { await new Promise(() => { setInterval(() => {}, 1000); }); });
`);
    writeFileSync(join(dir, 'c.test.mjs'), `import test from 'node:test'; import assert from 'node:assert';
test('rosso vero', () => { assert.equal(1, 2); });
`);
    const r = spawnSync(process.execPath, [RIPROVA, '--registro', join(tmp, 'unit.log')], {
      cwd: RADICE,
      env: { ...process.env, FILO_UNIT_DIR: rel, FILO_UNIT_TETTO_FERMO_MS: '4000' },
      encoding: 'utf8',
      timeout: 100_000,
    });
    const uscita = `${r.stdout}\n${r.stderr}`;
    expect(uscita, 'la prima corsa deve essersi fermata sul file appeso').toMatch(/b\.test\.mjs non è andato avanti/);
    expect(r.status, `un file appeso e uno rosso vero mai riportato non possono dare un cancello verde:\n${uscita.slice(-1500)}`).not.toBe(0);
  } finally {
    togliCartella(dir);
    togliCartella(tmp);
  }
});
