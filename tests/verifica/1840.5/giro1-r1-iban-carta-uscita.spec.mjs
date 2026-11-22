// #1840.5 giro 1 — un'uscita chiesta in chat che porta un IBAN o una carta letti altrove chiede, come su main:
// la fonte unica non deve riconoscere meno coordinate bancarie di quante ne riconosceva la porta delle uscite.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/autonomia.js');
const A = globalThis.SN_AUTONOMIA;

test('r1 IBAN e carte che su main fermavano un\'uscita la fermano ancora', () => {
  for (const testo of [
    'IBAN: IT60X 05428 11101 000000123456',
    'IBAN IT60X0542811101000000123456BIC BPPIITRRXXX',
    'IT60X0542811101000000123456ABC',
    'ordine 1 4111 1111 1111 1111',
  ]) {
    expect(A.segreto(testo), testo).toBe('banca');
  }
});
