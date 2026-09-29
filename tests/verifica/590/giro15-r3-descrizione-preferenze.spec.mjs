// Giro 15, rilievo 3 (#590): la descrizione della lista nelle Preferenze non promette eccezioni che non esistono più.
import { test, expect, paginaInterna } from './helpers/rete15.mjs';

test('la descrizione della lista dei siti bloccati non parla di eccezioni per le ricerche o per le aperture di Filo', async ({ app, shell }) => {
  const pref = await paginaInterna(app, shell, 'filo://security', 'filo://security/security.html');
  const desc = pref.locator('#sec-siteblock-desc');
  await expect(desc).toBeVisible({ timeout: 8000 });
  await expect(desc).not.toContainText('motore di ricerca');
  await expect(desc).not.toContainText('lo apre Filo per te');
});
