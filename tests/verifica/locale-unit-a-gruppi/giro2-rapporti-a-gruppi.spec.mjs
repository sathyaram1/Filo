// Verifica locale «unit-a-gruppi», giro 2: porte del giro 1 ri-provate e chiuse. Con gli unit a gruppi un rapporto
// chiesto su file contiene i test di tutti i gruppi, e un junit resta un documento solo.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

function cartella(n) {
  const dir = cartellaTemporanea('unit-rapporti-');
  const prove = join(dir, 'prove');
  mkdirSync(prove);
  for (let i = 0; i < n; i++) {
    writeFileSync(join(prove, `f${String(i).padStart(3, '0')}-${'nome-lungo-'.repeat(15)}.test.mjs`),
      `import test from 'node:test';\ntest('caso-${i}', () => {});\n`);
  }
  return { dir, prove };
}

function lancia(prove, args) {
  return spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', ...args], {
    cwd: ROOT, env: { ...process.env, FILO_UNIT_DIR: prove, FILO_UNIT_TETTO_RIGA: '900' }, encoding: 'utf8',
  });
}

test.setTimeout(240_000);

test('junit chiesto su file: un documento solo con i test di tutti i gruppi', () => {
  const { dir, prove } = cartella(6);
  try {
    const out = join(dir, 'rapporto.xml');
    const r = lancia(prove, ['--test-reporter=junit', `--test-reporter-destination=${out}`]);
    expect(`${r.stdout}${r.stderr}`).toMatch(/\[test:unit\] \d+ file in [2-9] gruppi/);
    expect(r.status).toBe(0);
    const xml = readFileSync(out, 'utf8');
    expect(xml.match(/<\?xml/g)).toHaveLength(1);
    expect(xml.match(/<testcase /g)).toHaveLength(6);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('spec chiesto su file: contiene i test di tutti i gruppi', () => {
  const { dir, prove } = cartella(6);
  try {
    const out = join(dir, 'rapporto.txt');
    const r = lancia(prove, ['--test-reporter=spec', '--test-reporter-destination', out]);
    expect(r.status).toBe(0);
    const testo = readFileSync(out, 'utf8');
    for (let i = 0; i < 6; i++) expect(testo).toContain(`caso-${i}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
