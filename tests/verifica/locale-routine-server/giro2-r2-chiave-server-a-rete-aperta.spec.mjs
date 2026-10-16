// Giro 2, rilievo 2: con la chiave della routine server rimasta a rete aperta (come nasce) la routine server non deve
// accendersi a vuoto fino al tetto del giorno, e il pacemaker deve dire perché i lavori server restano fermi.

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

test.describe('r2 chiave della routine server a rete aperta', () => {
  test.skip(!SERVER, 'il worktree di filo-security accanto a questo non c’è');
  test.setTimeout(300_000);

  test('r2 nessuna accensione a vuoto e un segno che dice cosa manca', () => {
    const out = scenario('chiave-server-rete-aperta');
    expect(out.lavori, 'a rete aperta i lavori server non si prendono: è la regola').toBe(0);
    expect(out.avvisi.join('\n'), 'nessun avviso dice perché i lavori server restano fermi').toMatch(/server/);
    expect(out.accensioni, 'accensioni della routine server in una giornata, tutte buttate').toBe(0);
  });
});
