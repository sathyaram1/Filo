// Verifica #905.1 giro 2, rilievo 1: un archivio con un proxy senza utente e password, scritto così da chi esportava
// (non tolti dall'esportazione), deve prendere il posto del proxy di qui come ogni altra impostazione del backup.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExportZip, readExportZip, mergeImportedData } = require('../../../src/main/services/exportData.js');

test('r1 il proxy senza credenziali di un backup sostituisce quello di qui con utente e password', () => {
  // Sull'altro computer il proxy autorizza per indirizzo IP: niente utente e password, niente da togliere.
  const zip = buildExportZip({ settings: { proxy: { datacenter: 'nuovo.esempio.com:3128' } } });
  const archivio = readExportZip(zip);
  expect(archivio.proxySenzaCredenziali, 'l\'archivio non ha tolto niente al proxy').toEqual([]);
  const qui = { settings: { proxy: { datacenter: 'mario:pw12345@vecchio.esempio.com:8080' } } };
  const { merged } = mergeImportedData(qui, archivio.data, {});
  expect(merged.settings.proxy.datacenter).toBe('nuovo.esempio.com:3128');
});
