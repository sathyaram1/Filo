// Verifica locale «unit-a-gruppi», giro 2, rilievo 2: a gruppi, se il rapporto chiesto su file non si può
// scrivere, le ultime righe non devono dire «verde» né che il rapporto è stato riunito in quel file.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

test.setTimeout(240_000);

test('rapporto su una cartella che non esiste: esito rosso e nessuna riga che dica il contrario', () => {
  const dir = cartellaTemporanea('unit-rapporto-perso-');
  const prove = join(dir, 'prove');
  mkdirSync(prove);
  try {
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(prove, `f${String(i).padStart(3, '0')}-${'nome-lungo-'.repeat(15)}.test.mjs`),
        `import test from 'node:test';\ntest('caso-${i}', () => {});\n`);
    }
    const dest = join(dir, 'manca', 'rapporto.xml');
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', '--test-reporter=junit', `--test-reporter-destination=${dest}`], {
      cwd: ROOT, env: { ...process.env, FILO_UNIT_DIR: prove, FILO_UNIT_TETTO_RIGA: '900' }, encoding: 'utf8',
    });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toMatch(/\[test:unit\] \d+ file in [2-9] gruppi/);
    expect(existsSync(dest)).toBe(false);
    expect(r.status).not.toBe(0);
    expect(out).not.toMatch(/sono riuniti in/);
    const ultima = out.trim().split('\n').filter((l) => l.startsWith('[test:unit]')).pop();
    expect(ultima).not.toMatch(/verde/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
