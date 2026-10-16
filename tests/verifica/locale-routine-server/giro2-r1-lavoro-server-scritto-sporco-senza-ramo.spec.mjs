// Giro 2, rilievo 1: un lavoro server da fare (senza ramo) il cui contenuto è stato scritto da un biglietto sporco non
// deve accendere la routine server, che poi non lo può prendere. Pacemaker e canale veri su un database finto.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const AIUTO = fileURLToPath(new URL('./aiuti-giro2.cjs', import.meta.url));
const { SERVER } = createRequire(import.meta.url)(AIUTO);
const scenario = (nome) => {
  const r = spawnSync(process.execPath, [AIUTO, nome], { encoding: 'utf8', timeout: 240_000 });
  if (r.status !== 0) throw new Error(`scenario ${nome}: ${r.stderr}`);
  return JSON.parse(r.stdout);
};

test.describe('r1 lavoro server scritto da un biglietto sporco', () => {
  test.skip(!SERVER, 'il worktree di filo-security accanto a questo non c’è');
  test.setTimeout(300_000);

  test('r1 il banco funziona: lo stesso lavoro pulito accende la routine server e lei lo prende', () => {
    const out = scenario('controllo-pulito');
    expect(out.accensioni).toBeGreaterThan(0);
    expect(out.lavori).toBeGreaterThan(0);
  });

  test('r1 senza ramo e col contenuto scritto sporco la routine server non si accende a vuoto', () => {
    const out = scenario('scritto-sporco-senza-ramo');
    expect(out.lavori, 'il biglietto non lo dà comunque').toBe(0);
    expect(out.sondaggiConLavoro, 'il sondaggio promette un lavoro che il biglietto nega').toBe(0);
    expect(out.accensioni, 'accensioni della routine server in una giornata, tutte buttate').toBe(0);
  });
});
