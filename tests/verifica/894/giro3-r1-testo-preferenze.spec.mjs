// #894 giro 3: la descrizione dei controlli di rete in Sicurezza dice che il nome del sito esce solo con un indizio.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('la voce «Controlli di rete» dice che i registri ricevono il nome solo quando la pagina ha già un indizio', () => {
  require('../../../src/shared/i18n.js');
  const desc = globalThis.SN_I18N.STRINGS.it
    ? globalThis.SN_I18N.STRINGS.it.options_security_safebrowse_network_desc
    : globalThis.SN_I18N.t('options_security_safebrowse_network_desc');
  expect(desc).toMatch(/solo (quando|se)/i);
});
