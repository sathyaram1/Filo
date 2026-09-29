// Porte provate e chiuse nel giro 4 di home-invito: chi è nuovo e riceve l'invito dal collegamento dopo
// aver scritto, e la home col benvenuto dopo il riscatto nei due temi (lo screenshot va in tests/.shots).
import { test, expect } from '../../fixtures/electron.mjs';
import { usaServerFinto, homePage, prepara, riscattaDaCrediti } from './_crediti-finti.mjs';

const stato = usaServerFinto(test);
const BENVENUTO = /Ciao, sono Filo/;
const INVITO = /codice d.invito/i;
const OPT = { tab: { id: 5, url: 'filo://options/options.html' }, url: 'filo://options/options.html' };

async function scrivi(home, testo) {
  await home.fill('#input', testo);
  await home.press('#input', 'Enter');
}

async function scriviSenzaCrediti(home) {
  await expect(home.locator('#homeMessage')).toContainText(INVITO, { timeout: 30_000 });
  await scrivi(home, 'ciao');
  await expect(home.locator('#bubbles')).toContainText(INVITO, { timeout: 20_000 });
}

const onboarding = (app) => app.evaluate(async () => globalThis.SN_FILO_MEMORY.getOnboarding());

test('nuovo: scrivo prima dei crediti, poi l’invito arriva dal collegamento, e Filo si presenta nella home', async ({ app }) => {
  test.setTimeout(180_000);
  await prepara(app, stato.base);
  const home = await homePage(app);
  await scriviSenzaCrediti(home);
  const out = await app.evaluate(async () => globalThis.SN_WALLET_MAIN.redeemFromInvite('ABCD-EFGH'));
  expect(out.ok).toBe(true);
  await expect(home.locator('#bubbles')).toContainText(BENVENUTO, { timeout: 30_000 });
  await expect(home.locator('#bubbles')).not.toContainText(INVITO);
  expect((await onboarding(app)).thread.map((m) => m.role)).toEqual(['filo']);
});

for (const theme of ['light', 'dark']) {
  test(`nuovo, tema ${theme}: la home col benvenuto dopo il riscatto, da guardare`, async ({ app, shell, openTab }) => {
    test.setTimeout(180_000);
    await prepara(app, stato.base);
    await app.evaluate(async (_, [s, t]) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { theme: t } }, s), [OPT, theme]);
    const home = await homePage(app);
    await scriviSenzaCrediti(home);
    await riscattaDaCrediti(openTab);
    await shell.locator('.tab').first().click();
    await expect(home.locator('#bubbles')).toContainText(BENVENUTO, { timeout: 30_000 });
    await home.waitForTimeout(1500);
    await home.screenshot({ path: `tests/.shots/home-invito-giro4-${theme}.png` });
  });
}
