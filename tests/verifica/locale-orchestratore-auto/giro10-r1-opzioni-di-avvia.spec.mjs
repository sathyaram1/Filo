// Giro 10, rilievo 1: avvia con un'opzione numerica senza valore o con un valore sbagliato si ferma, e non si mangia --dry-run.
// Il binario di Claude è finto apposta: se avvia prendesse la strada vera, si fermerebbe comunque prima di lanciare.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const SCRIPT = resolve('scripts/orchestratore-locale.mjs');
const orchestra = (dir, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: 'utf8',
  timeout: 120_000,
  env: { ...process.env, FILO_ORCH_DIR: dir, FILO_CLAUDE_BIN: join(dir, 'claude-che-non-esiste.exe') },
});

for (const args of [
  ['--paralleli', '--dry-run'],
  ['--budget-istanza', '--dry-run'],
  ['--tetto', '--dry-run'],
  ['--paralleli', 'due', '--dry-run'],
  ['--budget-istanza', 'dieci', '--dry-run'],
]) {
  test(`avvia ${args.join(' ')}: rifiuta l'opzione e non prende la strada vera`, async () => {
    const dir = cartellaTemporanea('orch-g10-');
    expect(orchestra(dir, 'aggiungi', '41').status).toBe(0);
    const r = orchestra(dir, 'avvia', ...args);
    expect(r.status).not.toBe(0);
    expect(r.stderr).not.toMatch(/accesso suo|Claude Code non trovato/);
    expect(r.stderr).toMatch(/valore|numero/i);
  });
}
