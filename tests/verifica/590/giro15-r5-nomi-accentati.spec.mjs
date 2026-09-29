// Giro 15, rilievo 5 (#590): un nome con lettere accentate si legge come l'utente l'ha scritto, non nella forma «xn--».
import { test, expect, lista, apri, schedaSu, MUENCHEN, PAGINA_BLOCCATA, testiNotifiche, paginaInterna } from './helpers/rete15.mjs';

test('münchen.de: la notifica, la pagina «Sito bloccato» e la scheda lo chiamano münchen.de', async ({ app, shell, rete }) => {
  await lista(shell, ['münchen.de']);
  const notifiche = await testiNotifiche(app);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'http://münchen.de/');
  await expect.poll(async () => (await notifiche()).join(' '), { timeout: 6000 }).toContain('Sito bloccato');
  expect((await notifiche()).join(' ')).toContain('münchen.de');

  await lista(shell, []);
  const sito = rete.pagina(MUENCHEN, '/', '<h1>MUENCHEN</h1>');
  await apri(app, shell, sito);
  await lista(shell, ['münchen.de']);
  await expect.poll(async () => ((await schedaSu(app, MUENCHEN)) || {}).caricata || '', { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  const pagina = app.windows().find((w) => PAGINA_BLOCCATA.test(w.url()));
  await expect(pagina.locator('#err-host')).toHaveText('münchen.de');
  await expect(pagina).toHaveTitle('münchen.de');
});

test('münchen.de scritto nella lista delle Preferenze si rilegge münchen.de', async ({ app, shell }) => {
  const pref = await paginaInterna(app, shell, 'filo://security', 'filo://security/security.html');
  const campo = pref.locator('#sec-siteblock-blacklist');
  await campo.scrollIntoViewIfNeeded();
  await campo.fill('münchen.de');
  await campo.dispatchEvent('change');
  await pref.waitForTimeout(800);
  await pref.reload();
  await pref.waitForLoadState('domcontentloaded');
  await expect(pref.locator('#sec-siteblock-blacklist')).toHaveValue('münchen.de', { timeout: 6000 });
});
