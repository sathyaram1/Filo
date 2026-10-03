// Giro 14, rilievo 2: una chiave custodita stampata da un comando in un'altra forma arriva al modello, e al contrario esce.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/contenutoEsterno.js');
require('../../../src/shared/urlExfil.js');
const G = globalThis.SN_GUARDIANO_STATICO;
const E = globalThis.SN_URL_EXFIL;
const CHIAVE = 'FINTA-chiave-opzioni-7f3a9c2e5b8d10464e2a';

test('la chiave di Opzioni stampata in base64 da un comando non arriva al modello', () => {
  const uscita = Buffer.from(JSON.stringify({ apiKeys: { openrouter: CHIAVE } })).toString('base64');
  const messaggi = [{ role: 'tool', content: `<<<ESITO_COMANDO>>>\n${uscita}\n<<<FINE_ESITO_COMANDO>>>` }];
  expect(JSON.stringify(G.oscuraSegreti(messaggi, [CHIAVE]))).not.toContain(uscita);
});

test('la chiave di Opzioni scritta al contrario in un indirizzo non esce', () => {
  const rovescio = [...CHIAVE].reverse().join('');
  const v = E.valutaUscita({ type: 'NAVIGA', url: `https://raccolta.example/?k=${rovescio}` }, { segreti: [{ valore: CHIAVE, tipo: 'chiave' }] });
  expect(v.blocca).toBe(true);
});
