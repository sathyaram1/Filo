// #2294 giro 5 — il ritmo dei messaggi sui download chiesto in chat come «1h30» diventa un'ora, non due minuti.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/constants.js');
const C = globalThis.SN_CONST;

test('r1 «1h30» e «2h15» sono ore e minuti: la scelta più vicina è un\'ora', () => {
  for (const detto of ['1h30', '2h15', 'ogni 1h30']) {
    const n = C.minutiDaTesto(detto);
    expect(Number.isFinite(n) && n > 0 ? C.minutiFraDownload({ downloadOgniMin: n }) : null, detto).toBe(60);
  }
});
