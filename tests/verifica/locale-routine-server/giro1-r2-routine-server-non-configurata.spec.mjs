// Verifica locale «routine server», giro 1, rilievo 2: con i lavori server accesi e la routine server senza id, il
// pacemaker deve dire che manca, come fa per le routine normali, e non tacere mentre il lavoro resta fermo.
import { test, expect } from './../../fixtures/electron.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function funzioniDelServer() {
  if (process.env.FILO_SERVER_WORKTREE) return join(process.env.FILO_SERVER_WORKTREE, 'functions');
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: import.meta.dirname, encoding: 'utf8' });
  const ramo = String(r.stdout || '').trim().replace(/^claude\//, '');
  const segno = join('src', 'routine', 'pacemaker.js');
  let d = join(import.meta.dirname, '..', '..', '..');
  for (let i = 0; i < 8; i++) {
    for (const c of [join(d, 'filo-security', '.claude', 'worktrees', ramo, 'functions'), join(d, 'filo-security', 'functions')]) {
      if (existsSync(join(c, segno))) return c;
    }
    d = dirname(d);
  }
  return '';
}

test('r2 lavoro server in coda e routine server senza id: il pacemaker lo dice', async () => {
  const funzioni = funzioniDelServer();
  test.skip(!funzioni, 'checkout del server non trovato accanto al repo');
  const r = spawnSync(process.execPath, [join(import.meta.dirname, 'aiuti-giro1.mjs'), funzioni, 'non-configurata'], { encoding: 'utf8', timeout: 120000 });
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  const riga = String(r.stdout || '').trim().split('\n').pop();
  const { esito, logs } = JSON.parse(riga);
  const detto = [JSON.stringify(esito), ...logs].some((l) => /server/i.test(l) && /no_routine_id|no_token|non configurat|manca/i.test(l));
  expect(detto, `esito e log del pacemaker:\n${JSON.stringify(esito)}\n${logs.join('\n')}`).toBe(true);
});
