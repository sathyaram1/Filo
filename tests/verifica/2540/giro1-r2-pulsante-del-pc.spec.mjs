// #2540 giro 1, rilievo 2: per una suite del server che GitHub non ha avviato il PC dice all'owner come rilanciarla.
// «Suite del server» parte solo dalle spinte (nessun «Run workflow»): la strada che c'è è rilanciare la corsa chiusa.
import { test, expect } from '@playwright/test';
import { messageForServerMerge } from '../../../scripts/lib/owner-merge.mjs';

test('r2 il messaggio del PC per la suite non partita indica un modo di rilanciarla che esiste', () => {
  const url = 'https://github.com/sathyaram1/filo-security/actions/runs/43709496611';
  const msg = messageForServerMerge({ outcome: 'aspetta_suite', suite: 'non_partita', sha: 'e3f0305ce90e', url }, 'worker/x');
  expect(msg).toContain(url);
  expect(msg, 'la suite del server non ha il pulsante «Run workflow»').not.toMatch(/Run workflow/i);
  expect(msg).toMatch(/Re-run/i);
});
