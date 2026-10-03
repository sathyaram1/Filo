// Verifica locale «unit-a-gruppi», giro 4, rilievo 2: a gruppi un modello dato come argomento che prende file già
// trovati non li fa girare due volte, e il riepilogo conta come la corsa in un gruppo solo.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

test.setTimeout(240_000);

test('modello come argomento a gruppi: ogni file gira una volta e i conti tornano', () => {
  const dir = cartellaTemporanea('unit-modello-');
  const prove = join(dir, 'prove');
  mkdirSync(prove);
  try {
    const lungo = 'nome-lungo-'.repeat(15);
    for (const n of ['a', 'b', 'c']) {
      writeFileSync(join(prove, `${n}-${lungo}.test.mjs`), `import test from 'node:test';\ntest('caso-${n}', () => {});\n`);
    }
    const modello = `${prove.split('\\').join('/')}/a-*.test.mjs`;
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', modello], {
      cwd: ROOT, env: { ...process.env, FILO_UNIT_DIR: prove, FILO_UNIT_TETTO_RIGA: '900' }, encoding: 'utf8',
    });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toMatch(/\[test:unit\] 3 file in [2-9] gruppi/);
    expect(r.status).toBe(0);
    expect(out.match(/^ok \d+ - caso-a$/gm)).toHaveLength(1);
    expect(out).toMatch(/riepilogo di \d+ gruppi, 3 file: 3 test, 3 passati/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
