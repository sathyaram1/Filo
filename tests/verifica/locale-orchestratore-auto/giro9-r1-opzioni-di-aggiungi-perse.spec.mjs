// Giro 9, rilievo 1: aggiungi non perde in silenzio la richiesta dell'owner quando l'opzione è scritta male o senza testo.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const SCRIPT = resolve('scripts/orchestratore-locale.mjs');
const orchestra = (dir, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, FILO_ORCH_DIR: dir } });
const inCoda = (dir, n) => (existsSync(join(dir, 'stato.json')) ? JSON.parse(readFileSync(join(dir, 'stato.json'), 'utf8')).pratiche[n] : undefined);

for (const [caso, args] of [
  ['l’opzione della richiesta scritta male', ['--richeista', 'solo la parte del menu']],
  ['l’opzione della richiesta senza testo', ['--richiesta']],
]) {
  test(`aggiungi con ${caso}: il lavoro non entra in coda senza la richiesta, e il messaggio lo dice`, async () => {
    const dir = cartellaTemporanea('orch-g9-');
    const r = orchestra(dir, 'aggiungi', '41', ...args);
    expect(inCoda(dir, 41)).toBeUndefined();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/richiest|argomento|valore/i);
  });
}
