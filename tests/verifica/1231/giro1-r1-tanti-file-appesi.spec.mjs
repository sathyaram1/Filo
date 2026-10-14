// Verifica #1231 giro 1: più file appesi insieme (un pacchetto mancante che ne blocca diversi, il disco pieno) non
// devono costare un tetto ciascuno, uno dopo l'altro: la corsa finisce in circa un tetto e li dice tutti rossi.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TETTO_MS = 4000;
const APPESO = "import { test } from 'node:test';\nconst tieni = setInterval(() => {}, 60_000);\ntest('appeso', async () => { await new Promise(() => {}); });\n";

test('r1 quattro file appesi insieme: la corsa finisce in circa un tetto, non in quattro, e li nomina tutti', () => {
  test.setTimeout(180_000);
  const dir = cartellaTemporanea('filo-verifica-1231-');
  try {
    const nomi = ['a', 'b', 'c', 'd'].map((n) => `${n}-appeso.test.mjs`);
    for (const n of nomi) writeFileSync(join(dir, n), APPESO);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', '--test-concurrency=4'], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 150_000,
      env: { ...process.env, FILO_UNIT_DIR: dir, FILO_UNIT_TETTO_FERMO_MS: String(TETTO_MS) },
    });
    const durata = Date.now() - t0;
    const uscita = `${r.stdout}\n${r.stderr}`;
    expect(r.status, uscita).toBe(1);
    for (const n of nomi) expect(uscita, `${n} non è nominato fra i rossi`).toMatch(new RegExp(`ROSSO[^\\n]*${n}|${n}[^\\n]*\\n[^\\n]*ROSSO|chiusi[^\\n]*${n}`));
    expect(durata, `la corsa ha impiegato ${durata} ms con un tetto di ${TETTO_MS} ms`).toBeLessThan(TETTO_MS * 2.5);
  } finally {
    togliCartella(dir);
  }
});
