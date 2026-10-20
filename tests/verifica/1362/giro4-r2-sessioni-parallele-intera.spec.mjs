// Verifica #1362, giro 4, rilievo 2: la prova delle sessioni parallele nominata nella segnalazione, lanciata intera e
// senza ritentativi, è rossa al secondo caso (la porta del giro 3, rilievo 2, riaperta). Nessun Electron.
import { test, expect } from './../../fixtures/electron.mjs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const RADICE = join(import.meta.dirname, '..', '..', '..');

test('r2 la prova delle sessioni parallele passa intera al primo tentativo', () => {
  test.setTimeout(180000);
  const r = spawnSync('npx', ['playwright', 'test', 'tests/verifica/locale-fiducia/giro3-r1-sessioni-parallele.spec.mjs', '--retries=0', '--workers=1'], {
    cwd: RADICE, encoding: 'utf8', timeout: 170000, shell: process.platform === 'win32',
  });
  const uscita = `${r.stdout || ''}${r.stderr || ''}`;
  expect(r.status, uscita.slice(-2000)).toBe(0);
});
