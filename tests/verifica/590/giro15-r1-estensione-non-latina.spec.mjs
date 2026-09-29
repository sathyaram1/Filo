// Giro 15, rilievo 1 (#590): un sito con l'estensione in caratteri non latini si mette in lista e blocca.
import { test, expect, schede, RF, testiNotifiche, paginaInterna } from './helpers/rete15.mjs';

test('«сайт.рф» scritto nelle Preferenze entra in lista senza avvisi e il sito non si apre', async ({ app, shell, rete }) => {
  rete.pagina(RF, '/', '<h1>SITO RF</h1>');
  const pref = await paginaInterna(app, shell, 'filo://security', 'filo://security/security.html');
  const campo = pref.locator('#sec-siteblock-blacklist');
  await campo.scrollIntoViewIfNeeded();
  await campo.fill('сайт.рф');
  await campo.dispatchEvent('change');
  await pref.waitForTimeout(800);
  await expect(pref.locator('#sec-siteblock-blacklist-error')).toBeHidden();

  const notifiche = await testiNotifiche(app);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'http://сайт.рф/');
  await shell.waitForTimeout(2500);
  expect((await schede(app)).filter((u) => u.includes(RF))).toEqual([]);
  expect((await notifiche()).some((t) => /Sito bloccato/.test(t))).toBe(true);
});
