// Giro 3, rilievo 2: con due chiavi server vive, la vecchia a rete limitata e la nuova (nel prompt della routine) a
// rete aperta come nasce, la routine server non deve accendersi a vuoto in silenzio. Pacemaker e canale veri.

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

test.describe('r2 chiave server ruotata a metà', () => {
  test.skip(!SERVER, 'il worktree di filo-security accanto a questo non c’è');
  test.setTimeout(300_000);

  test('r2 nessuna giornata di accensioni a vuoto senza un avviso', () => {
    const out = scenario('chiave-server-ruotata');
    expect(out.lavori, 'a rete aperta i lavori server non si prendono: è la regola').toBe(0);
    const avvisato = out.avvisi.some((a) => /server/.test(a));
    expect(out.accese.routS === 0 || avvisato, `accensioni a vuoto: ${out.accese.routS}, avvisi: ${out.avvisi.length}`).toBe(true);
  });
});
