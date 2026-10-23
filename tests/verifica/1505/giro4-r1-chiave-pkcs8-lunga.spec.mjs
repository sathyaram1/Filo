// Verifica #1505 giro 4: dopo il riallineamento la forma pkcs8 arrivata da main (#1507) non ha il tetto di lunghezza
// che il ramo mette a ogni chiave: un token lunghissimo che comincia così torna a far lanciare la lettura dei segreti.
// Regex provata in Node, non in Electron.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
const G = globalThis.SN_GUARDIANO_STATICO;

test('r1 un token di 8 milioni di caratteri con l\'inizio di una chiave pkcs8 dà un verdetto, saturo', () => {
  const testo = 'pagina MC4CAQAwBQYDK2VwBCIEI' + 'A'.repeat(8e6) + ' fine';
  const inizio = Date.now();
  let esito;
  expect(() => { esito = G.segretiNelTesto(testo); }).not.toThrow();
  expect(Date.now() - inizio).toBeLessThan(2000);
  expect(esito.saturo).toBe(true);
});

test('r1 la chiave pkcs8 di misura normale resta riconosciuta', () => {
  const k = 'MC4CAQAwBQYDK2VwBCIEIGx0aGlzaXNhcmVhbGx5c2VjcmV0a2V5Zm9ydGVzdHM=';
  expect(G.segretiNelTesto('chiave: ' + k).some((s) => s.regola === 'chiave')).toBe(true);
});
