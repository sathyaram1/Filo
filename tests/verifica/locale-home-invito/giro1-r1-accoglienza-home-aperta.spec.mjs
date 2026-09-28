// Rilievo 1 del giro 1: chi è nuovo e riceve i crediti con la home aperta deve vedere
// partire l'intervista di benvenuto lì, come in una scheda nuova. Tre strade verso la chiave.
import { test, expect } from '../../fixtures/electron.mjs';
import { usaServerFinto, homePage, nuovaHome, prepara, riscattaDaCrediti, testoHome } from './_crediti-finti.mjs';

const stato = usaServerFinto(test);
const INVITO = /codice d.invito|riscatta l.invito/i;

async function accoglienzaNellaHomeAperta(app, shell, home) {
  await expect.poll(() => testoHome(home), { timeout: 25_000 }).not.toMatch(INVITO);
  await expect(home.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
  await expect(home.locator('.dash-bubble-filo').first()).toContainText('Ciao, sono Filo');
  const nuova = await nuovaHome(app, shell);
  await expect(nuova.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
}

test('invito riscattato a mano dalla pagina Crediti', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app, stato.base);
  const home = await homePage(app);
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  await riscattaDaCrediti(openTab);
  await shell.locator('.tab').first().click();
  await accoglienzaNellaHomeAperta(app, shell, home);
});

test('invito in attesa del primo avvio che arriva dopo la home', async ({ app, shell }) => {
  test.setTimeout(150_000);
  stato.pendingCode = 'ABCDEFGH';
  stato.trattieni = true;
  await prepara(app, stato.base);
  const home = await homePage(app);
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  await expect.poll(() => stato.trattenute.length, { timeout: 30_000 }).toBeGreaterThan(0);
  stato.trattieni = false;
  for (const r of stato.trattenute.splice(0)) r();
  await expect.poll(() => stato.redeemed, { timeout: 20_000 }).toBe(true);
  await accoglienzaNellaHomeAperta(app, shell, home);
});

test('chiave OpenRouter propria messa dalle Impostazioni', async ({ app, shell }) => {
  test.setTimeout(150_000);
  await prepara(app, stato.base);
  const home = await homePage(app);
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  const opt = { tab: { id: 5, url: 'filo://options/options.html' }, url: 'filo://options/options.html' };
  await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-or-v1-mia' } } }, s), opt);
  await accoglienzaNellaHomeAperta(app, shell, home);
});
