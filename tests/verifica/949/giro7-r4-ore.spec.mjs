// Verifica #949 giro 7, rilievo 4: «Archivia dopo 1 ore di inattività».
import { test, expect } from '../../fixtures/electron.mjs';

test('un\'ora di inattività si scrive al singolare', async ({ app }) => {
  const label = await app.evaluate(() => globalThis.SN_PREF.buildPreferencePartial('ore_inattivita', '1').label);
  expect(label).not.toMatch(/\b1 ore\b/);
});
