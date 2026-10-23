import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const N = createRequire(import.meta.url)('../../../src/shared/nomiSito.js');

test('r1 un nome scritto dopo un indirizzo con un percorso, sulla stessa riga, non sparisce in silenzio', () => {
  const r = N.elencoDaTesto('https://banca-x.test/login studio rossi');
  expect(r.valid).toEqual(['banca-x.test']);
  expect(r.invalid).toEqual(['studio rossi']);
});
