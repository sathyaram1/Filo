// Verifica #2571 giro 1, rilievo 2: dopo un riavvio i contatori delle uccisioni per memoria ripartono da zero. Il guasto
// non deve concludere «nessun processo ucciso per memoria» né stampare conti negativi.

import { test, expect } from '@playwright/test';

const { guastoDellaCorsa } = await import('../../../scripts/lib/corsa-controlli.mjs');

test('r2 contatori più bassi di quelli letti alla partenza: niente conti negativi e niente «nessun processo ucciso per memoria»', () => {
  const allaPartenza = { disponibileMb: 12000, totaleMb: 16000, tettoMb: 13675, usataMb: 1000, piccoMb: 13600, uccisioniComandi: 3, uccisioniSistema: 2 };
  const dopoIlRiavvio = { disponibileMb: 12900, totaleMb: 16000, tettoMb: 13675, usataMb: 300, piccoMb: 400, uccisioniComandi: 0, uccisioniSistema: 0 };
  const segno = { pid: 1, sha: 'abcdef1234567890', inizio: '2026-11-17T18:40:00Z', fase: 'spec', faseDa: '2026-11-17T19:00:00Z', memoria: allaPartenza };
  const g = guastoDellaCorsa(segno, dopoIlRiavvio);
  expect(g).not.toMatch(/-\d+ (nella macchina|fra i comandi)/);
  expect(g).not.toMatch(/nessun processo ucciso per memoria/);
});
