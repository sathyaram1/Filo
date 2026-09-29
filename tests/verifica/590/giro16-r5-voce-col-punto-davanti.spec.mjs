// Verifica #590 giro 16, rilievo 5: «.sito.it» (la forma «sito e sottodomini» di cookie e filtri)
// o blocca, o viene rifiutata dicendolo; accettarla muta e non bloccare niente dà falsa sicurezza.
import { test, expect, schede } from '../../helpers/reteFinta.mjs';

test('una voce col punto davanti blocca il sito, oppure l\'avviso la nomina', async ({ app, shell, rete }) => {
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  await expect.poll(() => !!app.windows().find((w) => w.url().startsWith('filo://security')), { timeout: 8000 }).toBe(true);
  const pref = app.windows().find((w) => w.url().startsWith('filo://security'));
  await pref.waitForLoadState('domcontentloaded');
  const campo = pref.locator('#sec-siteblock-blacklist');
  await campo.scrollIntoViewIfNeeded();
  await campo.fill('.blocked.test');
  await campo.dispatchEvent('change');
  await pref.waitForTimeout(800);
  const avviso = pref.locator('#sec-siteblock-blacklist-error');
  const detta = (await avviso.isVisible()) && (await avviso.innerText()).includes('.blocked.test');

  await shell.evaluate((u) => window.filoShell.tabs.open(u), sito);
  await shell.waitForTimeout(2500);
  const aperto = (await schede(app)).includes(sito);
  expect({ detta, aperto }, 'la voce è stata accettata in silenzio e il sito si apre').not.toEqual({ detta: false, aperto: true });
});
