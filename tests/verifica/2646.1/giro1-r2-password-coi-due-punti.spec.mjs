// Verifica #2646.1 giro 1: «utente:password@host:porta» con una password come «123:x» su main si leggeva; l'utente
// con la chiocciola degli elenchi non deve farlo leggere come elenco (host «mario», porta 123).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/main/services/proxyTab.js');
require('../../../src/shared/constants.js');

test('r2 una password che comincia con cifre e due punti si collega al fornitore giusto ed è custodita intera', () => {
  const v = 'mario:123:x@gate.esempio.com:8080';
  const ep = P.endpointFor(v, 'it');
  expect(ep.proxyRules).toBe('http://gate.esempio.com:8080');
  expect(ep.auth).toEqual({ username: 'mario', password: '123:x' });
  const segreti = globalThis.SN_CONST.segretiDelProxy(v).map((x) => x.valore);
  expect(segreti).toContain('123:x');
  expect(globalThis.SN_CONST.credenzialiProxy(v).senza).toBe('gate.esempio.com:8080');
});
