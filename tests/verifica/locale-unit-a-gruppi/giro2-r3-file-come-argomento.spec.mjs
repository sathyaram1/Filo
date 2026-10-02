// Verifica locale «unit-a-gruppi», giro 2, rilievo 3: a gruppi, un file di prova dato come argomento gira una
// volta sola e il riepilogo conta i test che sono girati davvero, come quando i file stanno in un gruppo.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

test.setTimeout(240_000);

test.fail(true, 'rilievo 3 del giro 2 aperto: il file dato come argomento gira in ogni gruppo e il riepilogo conta zero test');
test('file come argomento a gruppi: gira una volta e il riepilogo conta tutti i test', () => {
  const dir = cartellaTemporanea('unit-argomento-');
  const prove = join(dir, 'prove');
  mkdirSync(prove);
  try {
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(prove, `f${String(i).padStart(3, '0')}.test.mjs`),
        `import test from 'node:test';\ntest('caso-${i}', () => {});\n`);
    }
    const extra = join(dir, 'extra.test.mjs');
    writeFileSync(extra, `import test from 'node:test';\ntest('extra', () => {});\n`);
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', extra], {
      cwd: ROOT, env: { ...process.env, FILO_UNIT_DIR: prove, FILO_UNIT_TETTO_RIGA: '900' }, encoding: 'utf8',
    });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toMatch(/\[test:unit\] \d+ file in [2-9] gruppi/);
    expect(r.status).toBe(0);
    expect(out.match(/ok \d+ - extra/g)).toHaveLength(1);
    expect(out).toMatch(/riepilogo di \d+ gruppi, 4 file: 5 test, 5 passati, 0 falliti/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
