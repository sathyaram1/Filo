// Verifica locale «clone-worker», giro 5, rilievo 2: uno spec che cade al primo tentativo e passa al secondo è verde
// per Playwright e per finish:check (uscita 0), quindi non è un rosso in più e non deve abbassare K.
import { test, expect } from '@playwright/test';
import { calcolaK, erroriInfrastruttura, estraiRossi, testFatti } from '../../../scripts/misura-k.mjs';

const UNIT = 'TAP version 13\nok 1 - uno\nok 2 - due\n1..2\n# tests 2\n# pass 2\n# fail 0\n';

const verde = `${UNIT}\nRunning 13 tests using 1 worker\n\n  13 passed (1.3m)\n`;

// Le righe come le scrive il reporter list del progetto: su Windows «x» e barre rovesciate, altrove «✘».
const instabile = {
  windows: `${UNIT}
Running 13 tests using 1 worker

  x  1 tests\\context-menu.spec.mjs:20:3 › il menu si apre (9.1s)
  ok 2 tests\\context-menu.spec.mjs:20:3 › il menu si apre (retry #1) (4.2s)

  1) tests\\context-menu.spec.mjs:20:3 › il menu si apre

    Error: expect(locator).toBeVisible() failed

  1 flaky
    tests\\context-menu.spec.mjs:20:3 › il menu si apre ─
  12 passed (1.4m)
`,
  linux: `${UNIT}
Running 13 tests using 1 worker

  ✘  1 tests/context-menu.spec.mjs:20:3 › il menu si apre (9.1s)
  ✓  2 tests/context-menu.spec.mjs:20:3 › il menu si apre (retry #1) (4.2s)

  1) tests/context-menu.spec.mjs:20:3 › il menu si apre ──────────────────

    Error: expect(locator).toBeVisible() failed

  1 flaky
    tests/context-menu.spec.mjs:20:3 › il menu si apre ───────────────────
  12 passed (1.4m)
`,
};

function corsa(logs) {
  return {
    n: logs.length,
    durateMs: logs.map(() => 60_000),
    codici: logs.map(() => 0),
    rossi: [...new Set(logs.flatMap(estraiRossi))].sort(),
    rossiPerWorker: logs.map(estraiRossi),
    fattiPerWorker: logs.map(testFatti),
    infra: [...new Set(logs.flatMap(erroriInfrastruttura))],
    piccoMb: 0,
    tettoMb: 0,
  };
}

for (const [dove, log] of Object.entries(instabile)) {
  test(`r2 uno spec passato al secondo tentativo non abbassa K, uscita come su ${dove}`, () => {
    const { k, motivo } = calcolaK([corsa([verde]), corsa([verde]), corsa([verde, log])]);
    expect(motivo).toBe('');
    expect(k).toBe(2);
  });
}
