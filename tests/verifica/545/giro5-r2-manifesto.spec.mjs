// #545 giro 5, rilievo 2: l'elenco di cosa sa fare Filo deve dire che i moduli dell'Editor prendono una scorciatoia.
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('il manifesto nomina le scorciatoie dei moduli dell\'Editor', () => {
  require('../../../src/shared/capabilities.js');
  const voce = JSON.stringify(globalThis.SN_CAPABILITIES.get('editor'));
  expect(voce).toMatch(/(scorciatoi[^.]*modul|modul[^.]*scorciatoi)/i);
});
