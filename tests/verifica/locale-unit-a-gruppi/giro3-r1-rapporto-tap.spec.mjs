// Verifica locale «unit-a-gruppi», giro 3, rilievo 1: a gruppi, un rapporto tap chiesto su file è un documento
// solo, con un piano e un conto finale che valgono per tutti i test, come con un gruppo solo.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

test.setTimeout(240_000);

test('tap chiesto su file a gruppi: un documento solo col conto di tutti i test', () => {
  const dir = cartellaTemporanea('unit-tap-');
  const prove = join(dir, 'prove');
  mkdirSync(prove);
  try {
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(prove, `f${String(i).padStart(3, '0')}-${'nome-lungo-'.repeat(15)}.test.mjs`),
        `import test from 'node:test';\ntest('caso-${i}', () => {});\n`);
    }
    const out = join(dir, 'rapporto.tap');
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', '--test-reporter=tap', `--test-reporter-destination=${out}`], {
      cwd: ROOT, env: { ...process.env, FILO_UNIT_DIR: prove, FILO_UNIT_TETTO_RIGA: '900' }, encoding: 'utf8',
    });
    expect(`${r.stdout}${r.stderr}`).toMatch(/\[test:unit\] \d+ file in [2-9] gruppi/);
    expect(r.status).toBe(0);
    const tap = readFileSync(out, 'utf8');
    expect(tap.match(/^TAP version/gm)).toHaveLength(1);
    expect(tap.match(/^1\.\.\d+$/gm)).toEqual(['1..6']);
    expect(tap.match(/^# tests \d+$/gm)).toEqual(['# tests 6']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
