// Verifica locale «unit-a-gruppi», giro 3, rilievo 2: il riepilogo a gruppi scrive in italiano corretto anche con
// un solo test rosso e con un numero di gruppi che comincia per vocale.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

test.setTimeout(240_000);

test('un test rosso e otto gruppi: niente «1 falliti» né «dei 8»', () => {
  const dir = cartellaTemporanea('unit-italiano-');
  const prove = join(dir, 'prove');
  mkdirSync(prove);
  try {
    for (let i = 0; i < 8; i++) {
      const corpo = i === 7 ? 'throw new Error(\'rosso\')' : '';
      writeFileSync(join(prove, `f${String(i).padStart(3, '0')}.test.mjs`),
        `import test from 'node:test';\ntest('caso-${i}', () => { ${corpo} });\n`);
    }
    const out = join(dir, 'rapporto.txt');
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', '--test-reporter=spec', `--test-reporter-destination=${out}`], {
      cwd: ROOT, env: { ...process.env, FILO_UNIT_DIR: prove, FILO_UNIT_TETTO_RIGA: '1' }, encoding: 'utf8',
    });
    const testo = `${r.stdout}${r.stderr}`;
    expect(testo).toMatch(/\[test:unit\] 8 file in 8 gruppi/);
    expect(r.status).not.toBe(0);
    expect(testo).toMatch(/riepilogo di 8 gruppi, 8 file: 8 test, 7 passati, 1 fallito\./);
    expect(testo).not.toMatch(/\bdei 8\b/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
