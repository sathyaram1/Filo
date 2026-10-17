// Giro 3, rilievo 1: la routine server gira su un account claude.ai (A o B) e deve rispettarne i limiti: il tetto
// giornaliero per account e l'esclusione dell'account. Pacemaker e canale veri su un database finto.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const AIUTO = fileURLToPath(new URL('./aiuti-giro3.cjs', import.meta.url));
const { SERVER } = createRequire(import.meta.url)(AIUTO);
const scenario = (nome) => {
  const r = spawnSync(process.execPath, [AIUTO, nome], { encoding: 'utf8', timeout: 240_000 });
  if (r.status !== 0) throw new Error(`scenario ${nome}: ${r.stderr}`);
  return JSON.parse(r.stdout);
};

test.describe('r1 limiti dell account su cui gira la routine server', () => {
  test.skip(!SERVER, 'il worktree di filo-security accanto a questo non c’è');
  test.setTimeout(300_000);

  test('r1 il banco funziona: un lavoro server pulito accende la routine server e lei lo prende', () => {
    const out = scenario('controllo-pulito');
    expect(out.accese.routS).toBeGreaterThan(0);
    expect(out.lavori).toBeGreaterThan(0);
  });

  test('r1 con B già a dodici accensioni oggi la routine server su B non lo porta oltre il tetto', () => {
    const out = scenario('tetto-di-b');
    expect(out.accensioniSuB, 'accensioni in un giorno sull account B, tetto per account 12').toBeLessThanOrEqual(12);
  });

  test('r1 con B escluso dall owner la routine server che gira su B non si accende', () => {
    const out = scenario('b-escluso');
    expect(out.accese.routS, 'accensioni sull account escluso').toBe(0);
  });
});
