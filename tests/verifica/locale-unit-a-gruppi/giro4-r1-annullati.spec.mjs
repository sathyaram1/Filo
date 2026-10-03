// Verifica locale «unit-a-gruppi», giro 4, rilievo 1: a gruppi il riepilogo finale conta come node --test e nomina
// ogni test rosso, anche quelli annullati: niente «uscito rosso senza un test rosso registrato» con un test appeso.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

test.setTimeout(240_000);

test('test appeso o scaduto a gruppi: conti uguali a node e il test rosso nominato nel riepilogo', () => {
  const dir = cartellaTemporanea('unit-annullati-');
  const prove = join(dir, 'prove');
  mkdirSync(prove);
  try {
    const lungo = 'nome-lungo-'.repeat(15);
    writeFileSync(join(prove, `a-${lungo}.test.mjs`), `import test from 'node:test';\ntest('a passa', () => {});\n`);
    writeFileSync(join(prove, `b-${lungo}.test.mjs`),
      `import test from 'node:test';\ntest('b appeso', () => new Promise(() => {}));\n`);
    writeFileSync(join(prove, `c-${lungo}.test.mjs`),
      `import test from 'node:test';\ntest('c scade', { timeout: 100 }, () => new Promise((ok) => setTimeout(ok, 3000)));\n`);
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs'], {
      cwd: ROOT, env: { ...process.env, FILO_UNIT_DIR: prove, FILO_UNIT_TETTO_RIGA: '900' }, encoding: 'utf8',
    });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toMatch(/\[test:unit\] 3 file in [2-9] gruppi/);
    expect(r.status).not.toBe(0);
    const somma = (k) => [...out.matchAll(new RegExp(`^# ${k} (\\d+)$`, 'gm'))].reduce((n, m) => n + Number(m[1]), 0);
    const riga = out.match(/riepilogo di \d+ gruppi, 3 file: (\d+) test, (\d+) passat[oi], (\d+) fallit[oi](?:, (\d+) annullat[oi])?/);
    expect(riga).not.toBeNull();
    expect({ test: Number(riga[1]), pass: Number(riga[2]), fail: Number(riga[3]), annullati: Number(riga[4] || 0) })
      .toEqual({ test: somma('tests'), pass: somma('pass'), fail: somma('fail'), annullati: somma('cancelled') });
    expect(out).not.toContain('senza un test rosso registrato');
    const elenco = out.slice(out.indexOf('[test:unit] test rossi'));
    expect(elenco).toContain('b appeso');
    expect(elenco).toContain('c scade');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
