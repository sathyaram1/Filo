// #1004 giro 2, rilievo 1: i siti che Filo segna da solo come delicati (campo password o carta visto) si vedono in
// Sicurezza e si possono togliere. Con un accesso a Google il sito segnato vale per Documenti, Maps e Ricerca.

import { test, expect } from '../../fixtures/electron.mjs';

test('il sito segnato da solo per il campo password si vede in Sicurezza', async ({ app, openTab }) => {
  await app.evaluate(() => globalThis.SN_DELICATE.segnaCampi('https://accounts.google.com/signin/v2/identifier'));
  const delicata = await app.evaluate(async () => (await globalThis.SN_DELICATE.filtro())('https://docs.google.com/document/d/1/edit'));
  expect(delicata, 'premessa: dopo l\'accesso a Google, anche un documento di Google Docs vale delicato').toBe('campi');

  const sicurezza = await openTab('filo://security/security.html');
  await expect(sicurezza.locator('#sec-delicate')).toBeChecked({ timeout: 8000 });
  await expect(sicurezza.locator('body'), 'in Sicurezza non si vede che google.com è delicato').toContainText('google.com', { timeout: 4000 });
});
