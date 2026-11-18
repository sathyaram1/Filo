// Verifica #2540.1, giro 1, rilievo 2: sul PC, per una suite del server che su quel commit non ha nessuna corsa, il
// messaggio manda ancora a «Run workflow» di «Suite del server», che parte solo dalle spinte e quel pulsante non l'ha.
import { test, expect } from './../../fixtures/electron.mjs';
import { messageForServerMerge } from '../../../scripts/lib/owner-merge.mjs';

const RAMO = 'worker/f2540-20261116T070000Z';

test('r2 suite mai partita sul commit: il messaggio dal PC non chiede un «Run workflow» che la suite del server non ha', () => {
  const m = messageForServerMerge({ outcome: 'aspetta_suite', suite: 'assente', sha: 'a'.repeat(40) }, RAMO);
  expect(m).toContain('a'.repeat(9));
  expect(m).not.toMatch(/Run workflow/);
});

test('r2 suite chiusa senza partire: il messaggio porta alla corsa chiusa da rifare', () => {
  const m = messageForServerMerge({ outcome: 'aspetta_suite', suite: 'non_partita', sha: 'a'.repeat(40), url: 'https://github.com/x/y/actions/runs/9' }, RAMO);
  expect(m).not.toMatch(/Run workflow/);
  expect(m).toMatch(/Re-run jobs/);
});
