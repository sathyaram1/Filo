// #1088 giro 8: la descrizione sotto «Importa dati» non promette più ciò che l'importazione non fa.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/i18n.js');

test('r1 la descrizione del pulsante non dice che vince sempre il backup né che nulla si cancella', () => {
  const testo = globalThis.SN_I18N.STRINGS.it
    ? globalThis.SN_I18N.STRINGS.it.security_import_desc
    : globalThis.SN_I18N.t('security_import_desc');
  expect(testo).toBeTruthy();
  // Spesa, crediti, schede aperte e sveglie scadute non seguono «vince il backup»; oltre 1000 pagine salvate ne escono.
  expect(testo).not.toMatch(/dove c'è un conflitto, vince il backup/);
  expect(testo).not.toMatch(/non viene\s+cancellato/);
});
