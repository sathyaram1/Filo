// Giro 2 di home-invito: chi è nuovo e riceve il modello con la home aperta vede partire l'intervista lì.
import { test, expect } from '../../fixtures/electron.mjs';
import { usaServerFinto, homePage, prepara, riscattaDaCrediti, testoHome } from './_crediti-finti.mjs';

const stato = usaServerFinto(test);
const BENVENUTO = /Ciao, sono Filo/;

async function contaChiamateHome(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chiamateHome = 0;
    for (const nome of ['streamCompleteWithFallback', 'completeWithFallback']) {
      const f = P[nome];
      P[nome] = async (o) => {
        if (JSON.stringify(o.messages || []).includes('preparare la dashboard')) globalThis.__chiamateHome += 1;
        return f(o);
      };
    }
  });
}

async function homeNuova(app) {
  const home = await homePage(app);
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  return home;
}

async function intervistaNellaHome(home) {
  await expect(home.locator('#bubbles')).toContainText(BENVENUTO, { timeout: 30_000 });
  await expect(home.locator('body')).toHaveAttribute('data-state', 'thread');
}

test('nuovo: riscatto dalla pagina Crediti, torno alla home e Filo si presenta lì', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app, stato.base);
  await contaChiamateHome(app);
  const home = await homeNuova(app);
  await riscattaDaCrediti(openTab);
  await shell.locator('.tab').first().click();
  await intervistaNellaHome(home);
  await home.waitForTimeout(3000);
  expect(await app.evaluate(() => globalThis.__chiamateHome)).toBe(0);
});

test('nuovo: l’invito che aspetta al primo avvio arriva dopo la home, e Filo si presenta lì', async ({ app }) => {
  test.setTimeout(150_000);
  stato.pendingCode = 'ABCD-EFGH';
  stato.trattieni = true;
  await prepara(app, stato.base);
  const home = await homeNuova(app);
  await expect.poll(() => stato.trattenute.length, { timeout: 30_000 }).toBeGreaterThan(0);
  for (const r of stato.trattenute.splice(0)) r();
  await intervistaNellaHome(home);
  await home.screenshot({ path: 'tests/.shots/giro2-invito-primo-avvio.png' });
});

test('nuovo: l’invito che aspetta al primo avvio, senza trattenerlo', async ({ app }) => {
  test.setTimeout(150_000);
  stato.pendingCode = 'ABCD-EFGH';
  await prepara(app, stato.base);
  const home = await homePage(app);
  await intervistaNellaHome(home);
  expect(await testoHome(home)).not.toMatch(/codice d.invito/i);
});

test('nuovo: chiave OpenRouter scritta nelle Impostazioni, torno alla home e Filo si presenta lì', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app, stato.base);
  const home = await homeNuova(app);
  const opt = await openTab('filo://options/options.html');
  await expect(opt.locator('#apiKey')).toBeVisible({ timeout: 20_000 });
  await opt.fill('#apiKey', 'sk-or-v1-mia');
  await opt.locator('#apiKey').blur();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys?.openrouter), { timeout: 10_000 }).toBe('sk-or-v1-mia');
  await shell.locator('.tab').first().click();
  await intervistaNellaHome(home);
});

test('nuovo: chiave OpenRouter messa dalla pagina Crediti, torno alla home e Filo si presenta lì', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app, stato.base);
  const home = await homeNuova(app);
  const cr = await openTab('filo://credits/credits.html');
  await expect(cr.locator('#ownKeyInput')).toBeVisible({ timeout: 20_000 });
  await cr.fill('#ownKeyInput', 'sk-or-v1-mia');
  await cr.click('#ownKeySaveBtn');
  await expect(cr.locator('#ownKeyHave')).toBeVisible({ timeout: 10_000 });
  await shell.locator('.tab').first().click();
  await intervistaNellaHome(home);
});

test('nuovo: scrivo nella home prima dell’invito, poi riscatto da «Apri Crediti» e torno', async ({ app, shell }) => {
  test.setTimeout(150_000);
  await prepara(app, stato.base);
  const home = await homeNuova(app);
  await home.fill('#input', 'ciao, cosa sai fare?');
  await home.press('#input', 'Enter');
  const apri = home.locator('#bubbles button', { hasText: 'Apri Crediti' });
  await expect(apri).toBeVisible({ timeout: 20_000 });
  await apri.click();
  let cr = null;
  await expect.poll(() => { cr = app.windows().find((w) => w.url().startsWith('filo://credits')); return !!cr; }, { timeout: 15_000 }).toBe(true);
  await cr.waitForLoadState('domcontentloaded');
  await expect(cr.locator('#redeemForm')).toBeVisible({ timeout: 20_000 });
  await cr.fill('#inviteCode', 'ABCD-EFGH');
  await cr.click('#redeemBtn');
  await expect(cr.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20_000 });
  await shell.locator('.tab').first().click();
  await home.waitForTimeout(5000);
  const bolle = await home.locator('#bubbles').innerText();
  console.log('BOLLE DOPO IL RISCATTO:\n' + bolle);
  await home.screenshot({ path: 'tests/.shots/giro2-scritto-prima.png' });
  await intervistaNellaHome(home);
});
