// Giro 2, rilievo 1: chi scrive nella home prima di avere i crediti non vede mai l'intervista di benvenuto.
import { test, expect } from '../../fixtures/electron.mjs';
import { usaServerFinto, homePage, nuovaHome, prepara } from './_crediti-finti.mjs';

const stato = usaServerFinto(test);
const BENVENUTO = /Ciao, sono Filo/;

async function scriviSenzaCrediti(app) {
  const home = await homePage(app);
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  await home.fill('#input', 'ciao, cosa sai fare?');
  await home.press('#input', 'Enter');
  await expect(home.locator('#bubbles button', { hasText: 'Apri Crediti' })).toBeVisible({ timeout: 20_000 });
  return home;
}

async function riscattaDaApriCrediti(app, home) {
  await home.locator('#bubbles button', { hasText: 'Apri Crediti' }).click();
  let cr = null;
  await expect.poll(() => { cr = app.windows().find((w) => w.url().startsWith('filo://credits')); return !!cr; }, { timeout: 15_000 }).toBe(true);
  await cr.waitForLoadState('domcontentloaded');
  await expect(cr.locator('#redeemForm')).toBeVisible({ timeout: 20_000 });
  await cr.fill('#inviteCode', 'ABCD-EFGH');
  await cr.click('#redeemBtn');
  await expect(cr.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20_000 });
}

test('scritto nella home senza crediti, riscatto da «Apri Crediti»: tornato alla home, Filo si presenta lì', async ({ app, shell }) => {
  test.setTimeout(150_000);
  await prepara(app, stato.base);
  const home = await scriviSenzaCrediti(app);
  await riscattaDaApriCrediti(app, home);
  await shell.locator('.tab').first().click();
  await expect(home.locator('#bubbles')).toContainText(BENVENUTO, { timeout: 30_000 });
});

test('scritto nella home senza crediti, poi l’invito del primo avvio: Filo si presenta lì', async ({ app }) => {
  test.setTimeout(150_000);
  stato.pendingCode = 'ABCD-EFGH';
  stato.trattieni = true;
  await prepara(app, stato.base);
  const home = await scriviSenzaCrediti(app);
  await expect.poll(() => stato.trattenute.length, { timeout: 30_000 }).toBeGreaterThan(0);
  for (const r of stato.trattenute.splice(0)) r();
  await expect(home.locator('#bubbles')).toContainText(BENVENUTO, { timeout: 30_000 });
});

test('scritto nella home senza crediti: dopo il riscatto la scheda nuova apre l’intervista dal benvenuto', async ({ app, shell }) => {
  test.setTimeout(150_000);
  await prepara(app, stato.base);
  const home = await scriviSenzaCrediti(app);
  console.log('INTERVISTA DOPO IL TENTATIVO:', JSON.stringify(await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getOnboarding()).thread)));
  await riscattaDaApriCrediti(app, home);
  const nuova = await nuovaHome(app, shell);
  await expect(nuova.locator('#bubbles .dash-bubble-filo').first()).toContainText(BENVENUTO, { timeout: 30_000 });
});
