// Verifica #905, giro 1, rilievo 1: senza «Includi le chiavi» del proxy con utente e password deve uscire la
// password, non l'indirizzo; l'archivio rimesso su un computer senza proxy riporta l'indirizzo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExportZip, readExportZip, mergeImportedData } = require('../../../src/main/services/exportData.js');

test('il proxy con password esportato senza chiavi torna con il suo indirizzo, senza la password', () => {
  const PASSWORD = 'segretissima123';
  const zip = buildExportZip({ settings: { proxy: { datacenter: `http://mario:${PASSWORD}@proxy.example.com:8080` } } });
  expect(zip.includes(Buffer.from(PASSWORD)), 'la password non deve uscire').toBe(false);
  const { merged } = mergeImportedData({ settings: {} }, readExportZip(zip).data);
  expect(String(merged.settings.proxy && merged.settings.proxy.datacenter || '')).toContain('proxy.example.com:8080');
});
