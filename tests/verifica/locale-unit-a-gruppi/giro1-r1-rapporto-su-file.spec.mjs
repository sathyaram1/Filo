// Verifica locale «unit-a-gruppi», giro 1, rilievo 1: a gruppi, un rapporto chiesto su file deve contenere i test di
// tutti i gruppi, non solo dell'ultimo.
import { test, expect } from '@playwright/test';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

test.fail(true, 'rilievo 1 aperto: ogni gruppo riscrive da capo il file del rapporto');

test('il rapporto su file di una corsa a gruppi elenca i test di ogni gruppo', () => {
  const dir = cartellaTemporanea('unit-rapporto-');
  try {
    for (const n of ['uno', 'due', 'tre', 'quattro']) {
      writeFileSync(join(dir, `${n}.test.mjs`), `import test from 'node:test';\ntest('caso-${n}', () => {});\n`);
    }
    const rapporto = join(dir, 'rapporto.txt');
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', '--test-reporter=spec', `--test-reporter-destination=${rapporto}`], {
      cwd: ROOT, env: { ...process.env, FILO_UNIT_DIR: dir, FILO_UNIT_TETTO_RIGA: '900' }, encoding: 'utf8',
    });
    expect(`${r.stdout}`).toMatch(/\[test:unit\] 4 file in [2-9] gruppi/);
    const testo = readFileSync(rapporto, 'utf8');
    for (const n of ['uno', 'due', 'tre', 'quattro']) expect(testo).toContain(`caso-${n}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
