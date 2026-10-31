// Giro 1, rilievo 2: il controllo dell'app che tiene uguali l'elenco del PC e quello della guardia del server deve
// poter leggere l'elenco della guardia, nella forma in cui la guardia lo scrive. Non apre Filo; senza server si salta.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SERVER = [process.env.FILO_SECURITY_DIR || '', resolve(ROOT, '..', 'filo-security'), '/root/filo-security']
  .find((d) => d && existsSync(join(d, 'functions', 'tools', 'guardia-deploy.js')));

test('r2 la sentinella dell’app trova l’elenco delle fonti nella guardia del server', () => {
  test.skip(!SERVER, 'checkout di filo-security assente');
  const guardia = readFileSync(join(SERVER, 'functions', 'tools', 'guardia-deploy.js'), 'utf8');
  const sentinella = readFileSync(join(ROOT, 'tests', 'unit', 'orchestratore.test.mjs'), 'utf8');
  // La sentinella cerca l'elenco come letterale nella guardia: allora la guardia deve averlo così.
  if (sentinella.includes('const FONTI_BAKE = \\[')) {
    expect(/const FONTI_BAKE = \[([^\]]*)\]/.test(guardia), 'su un PC col server accanto la sentinella non trova l’elenco ed è rossa comunque').toBe(true);
  } else {
    expect(sentinella, 'la sentinella deve leggere l’elenco esportato dal bake').toMatch(/FONTI_PUBBLICHE/);
  }
});
