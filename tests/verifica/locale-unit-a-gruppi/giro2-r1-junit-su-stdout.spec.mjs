// Verifica locale «unit-a-gruppi», giro 2, rilievo 1: a gruppi, un junit chiesto sull'uscita standard e
// rediretto su un file deve restare un documento XML solo, come quando i file stanno in un gruppo.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

test.setTimeout(240_000);

test.fail(true, 'rilievo 1 del giro 2 aperto: a gruppi l’uscita standard porta un documento junit per gruppo e le righe del lanciatore');
test('junit sull’uscita standard a gruppi: un documento XML solo, senza altre righe', () => {
  const dir = cartellaTemporanea('unit-junit-stdout-');
  const prove = join(dir, 'prove');
  mkdirSync(prove);
  try {
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(prove, `f${String(i).padStart(3, '0')}.test.mjs`),
        `import test from 'node:test';\ntest('caso-${i}', () => {});\n`);
    }
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', '--test-reporter=junit'], {
      cwd: ROOT, env: { ...process.env, FILO_UNIT_DIR: prove, FILO_UNIT_TETTO_RIGA: '900' }, encoding: 'utf8',
    });
    expect(r.stderr + r.stdout).toMatch(/\[test:unit\] \d+ file in [2-9] gruppi/);
    expect(r.status).toBe(0);
    expect(r.stdout.match(/<\?xml/g)).toHaveLength(1);
    expect(r.stdout.match(/<testcase /g)).toHaveLength(6);
    expect(r.stdout.trim()).toMatch(/^<\?xml[\s\S]*<\/testsuites>$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
