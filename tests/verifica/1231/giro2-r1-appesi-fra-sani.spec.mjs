// Verifica #1231 giro 2: più file appesi insieme mentre gli altri file finiscono (un pacchetto mancante usato da più
// prove) devono chiudersi entro circa un tetto, non uno dopo l'altro, e la corsa deve proseguire con i file sani.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TETTO_MS = 8000;
const APPESO = "import { test } from 'node:test';\nconst tieni = setInterval(() => {}, 60_000);\ntest('appeso', async () => { await new Promise(() => {}); });\n";
const SANO = "import { test } from 'node:test';\ntest('sano', async () => { await new Promise((r) => setTimeout(r, 700)); });\n";

test('r1 tre file appesi mentre i sani finiscono: chiusi tutti entro circa un tetto, e i sani passano', () => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('filo-verifica-1231-');
  try {
    const appesi = ['a', 'b', 'c'].map((n) => `${n}-appeso.test.mjs`);
    for (const n of appesi) writeFileSync(join(dir, n), APPESO);
    for (let i = 10; i < 26; i++) writeFileSync(join(dir, `s${i}-sano.test.mjs`), SANO);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', '--test-concurrency=4'], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 200_000,
      env: { ...process.env, FILO_UNIT_DIR: dir, FILO_UNIT_TETTO_FERMO_MS: String(TETTO_MS) },
    });
    const durata = Date.now() - t0;
    const uscita = `${r.stdout}\n${r.stderr}`;
    expect(r.status, uscita).toBe(1);
    const nostre = uscita.split('\n').filter((l) => l.startsWith('[test:unit]')).join('\n');
    for (const n of appesi) expect(nostre, `${n} non è nominato nel verdetto`).toContain(n);
    expect(durata, `la corsa ha impiegato ${durata} ms con un tetto di ${TETTO_MS} ms\n${nostre}`).toBeLessThan(TETTO_MS * 2);
  } finally {
    togliCartella(dir);
  }
});

test('r1 due file appesi e un sano che finisce dopo il primo: la corsa non si chiude intera e il sano in fondo dice il suo esito', () => {
  test.setTimeout(120_000);
  const dir = cartellaTemporanea('filo-verifica-1231-');
  try {
    writeFileSync(join(dir, 'a-appeso.test.mjs'), APPESO);
    writeFileSync(join(dir, 'b-sano-lento.test.mjs'), "import { test } from 'node:test';\ntest('sano lento', async () => { await new Promise((r) => setTimeout(r, 2500)); });\n");
    writeFileSync(join(dir, 'c-appeso.test.mjs'), APPESO);
    writeFileSync(join(dir, 'd-sano.test.mjs'), "import { test } from 'node:test';\ntest('sano in fondo', () => {});\n");
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', '--test-concurrency=4'], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 100_000,
      env: { ...process.env, FILO_UNIT_DIR: dir, FILO_UNIT_TETTO_FERMO_MS: '6000' },
    });
    const uscita = `${r.stdout}\n${r.stderr}`;
    expect(r.status, uscita).toBe(1);
    expect(r.stdout, 'l\'esito del file sano dopo gli appesi è andato perso').toMatch(/^ok \d+ - sano in fondo$/m);
    expect(r.stdout).not.toMatch(/la corsa è stata chiusa/);
    expect(r.stdout).toMatch(/ROSSO: .*c-appeso\.test\.mjs non è andato avanti per .* ed è stato chiuso/);
  } finally {
    togliCartella(dir);
  }
});
