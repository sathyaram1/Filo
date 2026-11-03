// Verifica #1868, giro 1, rilievo 1: il caso dell'errore di rete dei contatori anonimi, lanciato da solo cinque volte
// di fila senza ritentativi, è verde ogni volta (il criterio della spec). Qui cade quando la navigazione verso la porta
// chiusa parte prima che la scheda caduta sia stata rimessa in piedi con la sua pagina d'errore.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(process.cwd());
const VOLTE = 5;

test.setTimeout(15 * 60_000);

test('r1 il caso dell’errore di rete è verde cinque volte di fila', async () => {
  const fuori = mkdtempSync(join(tmpdir(), 'filo-1868-r1-'));
  try {
    const r = spawnSync('npx', ['playwright', 'test', 'tests/contatori-anonimi.spec.mjs', '-g', 'pagina d’errore di rete',
      `--repeat-each=${VOLTE}`, '--retries=0', '--workers=1', '--reporter=line', `--output=${fuori}`],
    { cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 14 * 60_000 });
    const testo = `${r.stdout || ''}${r.stderr || ''}`;
    const passate = Number((testo.match(/(\d+) passed/) || [])[1] || 0);
    expect(passate, testo.slice(-1500)).toBe(VOLTE);
  } finally {
    rmSync(fuori, { recursive: true, force: true });
  }
});
