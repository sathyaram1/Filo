// Rilievo 1 del giro 3 di home-invito: chi ha già fatto l'intervista e scrive nella home prima dei crediti, dopo il
// riscatto ha ancora davanti la risposta «serve un codice d'invito».
import { test, expect } from '../../fixtures/electron.mjs';
import { usaServerFinto, homePage, prepara, onboardingFatto, riscattaDaCrediti } from './_crediti-finti.mjs';

const stato = usaServerFinto(test);
const INVITO = /codice d.invito/i;

test('già accolto: scrivo prima dei crediti, riscatto, e la home aperta non dice più che serve il codice', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  await prepara(app, stato.base);
  await onboardingFatto(app);
  const home = await homePage(app);
  await home.reload();
  await expect(home.locator('#homeMessage')).toContainText(INVITO, { timeout: 30_000 });
  await home.fill('#input', 'ciao');
  await home.press('#input', 'Enter');
  await expect(home.locator('#bubbles')).toContainText(INVITO, { timeout: 20_000 });
  await riscattaDaCrediti(openTab);
  await shell.locator('.tab').first().click();
  const aSchermo = () => home.evaluate(() => document.getElementById('center').innerText);
  await expect.poll(aSchermo, { timeout: 30_000 }).toMatch(/HOME-DAL-MODELLO|Dimmi pure\./);
  expect(await aSchermo()).not.toMatch(INVITO);
});
