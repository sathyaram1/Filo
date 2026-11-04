// Verifica #905.1 giro 1, rilievo 1: un proxy che Filo usa con utente e password deve valere come segreto anche se la
// password ha uno spazio: casella «Includi le chiavi», esportazione senza la password, cifratura sul disco.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExportZip } = require('../../../src/main/services/exportData.js');
const { endpointFor } = require('../../../src/main/services/proxyTab.js');
require('../../../src/shared/constants.js');

const PASSWORD = 'pass word segreta';
const PROXY = `mario:${PASSWORD}@gate.esempio.com:8080`;

test('r1 la password con uno spazio che Filo usa per il proxy non esce senza la spunta', () => {
  expect(endpointFor(PROXY, 'it').auth, 'Filo usa utente e password di questo proxy').toEqual({ username: 'mario', password: PASSWORD });
  expect(globalThis.SN_CONST.haSegreti({ proxy: { datacenter: PROXY } }), 'la casella «Includi le chiavi» deve comparire').toBe(true);
  const zip = buildExportZip({ settings: { proxy: { datacenter: PROXY } } });
  expect(zip.includes(Buffer.from(PASSWORD)), 'senza spunta la password non esce').toBe(false);
});
