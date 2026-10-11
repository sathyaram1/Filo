// Verifica locale «clone-worker», giro 5, rilievo 3: la misura dice di non contare i rossi noti di
// tests/rossi-noti.json, che lì sono scritti senza «.spec.mjs»; un rosso noto in un worker solo non abbassa K.
import { test, expect } from '@playwright/test';
import { calcolaK, erroriInfrastruttura, estraiRossi, rossiNotiDa, testFatti } from '../../../scripts/misura-k.mjs';

const UNIT = 'TAP version 13\nok 1 - uno\n1..1\n# tests 1\n# pass 1\n# fail 0\n';
const verde = `${UNIT}\n  13 passed (1.3m)\n`;
const conRossoNoto = `${UNIT}
  ✘  1 tests/transparency-page.spec.mjs:12:3 › un link a una fonte apre una scheda (3.0s)

  1) tests/transparency-page.spec.mjs:12:3 › un link a una fonte apre una scheda ─────

  1 failed
    tests/transparency-page.spec.mjs:12:3 › un link a una fonte apre una scheda ──────
  12 passed (1.3m)
`;

const corsa = (logs, codici) => ({
  n: logs.length,
  durateMs: logs.map(() => 60_000),
  codici,
  rossi: [...new Set(logs.flatMap(estraiRossi))].sort(),
  rossiPerWorker: logs.map(estraiRossi),
  fattiPerWorker: logs.map(testFatti),
  infra: [...new Set(logs.flatMap(erroriInfrastruttura))],
  piccoMb: 0,
  tettoMb: 0,
});

test('r3 un rosso noto del contenitore in un worker solo non abbassa K', () => {
  const rossiNoti = rossiNotiDa({ contenitore: { specs: [{ spec: 'tests/transparency-page', perche: 'internet' }] } });
  const { k, motivo } = calcolaK([corsa([verde], [0]), corsa([verde, conRossoNoto], [0, 1])], { rossiNoti });
  expect(motivo).toBe('');
  expect(k).toBe(2);
});
