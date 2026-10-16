// Verifica #905, giro 2, rilievo 1: un proxy scritto senza «http://» davanti (utente:password@host:porta, come lo
// danno molti fornitori) Filo lo usa, ma senza «Includi le chiavi» la password esce lo stesso nell'archivio.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExportZip, readExportZip } = require('../../../src/main/services/exportData.js');
const proxyTab = require('../../../src/main/services/proxyTab.js');

test('r1 il proxy senza schema con utente e password non porta la password nell\'archivio', () => {
  const PASSWORD = 'segretissima123';
  const proxy = `mario:${PASSWORD}@gate.example.com:8080`;
  const usato = proxyTab.resolve('it', { settings: { proxy: { datacenter: proxy } }, env: {} });
  expect(usato && usato.auth && usato.auth.password, 'Filo usa davvero quella password per il proxy').toBe(PASSWORD);
  const zip = buildExportZip({ settings: { proxy: { datacenter: proxy } } });
  expect(zip.includes(Buffer.from(PASSWORD)), 'la password del proxy non deve uscire senza la spunta').toBe(false);
  expect(String(readExportZip(zip).data.settings.proxy?.datacenter || '')).toContain('gate.example.com:8080');
});
